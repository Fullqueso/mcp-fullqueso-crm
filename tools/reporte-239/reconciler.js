import { round2, titleCase } from '../../utils/formatter.js';

const PAYMENT_TYPES = ['Punto', 'Pago Movil', 'Efectivo $', 'Efectivo Bs', 'Zelle'];

/**
 * Map OA method name → payment type.
 */
function mapMethodToType(metodo) {
  if (metodo === 'Efectivo $ Tienda') return 'Efectivo $';
  if (metodo === 'Efectivo Bs Tienda') return 'Efectivo Bs';
  if (metodo === 'Pago Movil Tienda Venezuela 5187') return 'Pago Movil';
  if (metodo === 'Zelle') return 'Zelle';
  return 'Punto';
}

/**
 * Aggregate OA methods into payment types, separately for FAV and NEN.
 */
function aggregateOAByType(reportData) {
  const result = { fav: {}, nen: {} };
  for (const type of PAYMENT_TYPES) {
    result.fav[type] = { bs: 0, usd: 0 };
    result.nen[type] = { bs: 0, usd: 0 };
  }
  for (const m of reportData.fav.methods) {
    const type = mapMethodToType(m.metodo);
    result.fav[type].bs = round2(result.fav[type].bs + m.bs);
    result.fav[type].usd = round2(result.fav[type].usd + m.usd);
  }
  for (const m of reportData.nen.methods) {
    const type = mapMethodToType(m.metodo);
    result.nen[type].bs = round2(result.nen[type].bs + m.bs);
    result.nen[type].usd = round2(result.nen[type].usd + m.usd);
  }
  return result;
}

/**
 * Aggregate Cajas conteo by payment type (with opening balance adjustment).
 */
function aggregateConteoByType(counterData) {
  const rate = counterData.rate || 0;
  const conteo = {};
  for (const type of PAYMENT_TYPES) {
    conteo[type] = { bs: 0, usd: 0 };
  }
  for (const c of counterData.counters) {
    conteo['Punto'].bs = round2(conteo['Punto'].bs + c.punto_detail.conteoBs);
    conteo['Punto'].usd = round2(conteo['Punto'].usd + c.punto_detail.conteoUsd);

    const adjVesConteo = round2(c.ves.conteo - c.efectivoBs);
    const adjVesConteoUsd = rate > 0 ? round2(adjVesConteo / rate) : 0;
    conteo['Efectivo Bs'].bs = round2(conteo['Efectivo Bs'].bs + adjVesConteo);
    conteo['Efectivo Bs'].usd = round2(conteo['Efectivo Bs'].usd + adjVesConteoUsd);

    const adjUsdConteo = round2(c.usd.conteo - c.efectivoUsd);
    conteo['Efectivo $'].usd = round2(conteo['Efectivo $'].usd + adjUsdConteo);
    conteo['Efectivo $'].bs = round2(conteo['Efectivo $'].bs + adjUsdConteo * rate);

    conteo['Pago Movil'].bs = round2(conteo['Pago Movil'].bs + c.movil.conteoBs);
    conteo['Pago Movil'].usd = round2(conteo['Pago Movil'].usd + c.movil.conteoUsd);

    conteo['Zelle'].usd = round2(conteo['Zelle'].usd + c.zelle.conteo);
    conteo['Zelle'].bs = round2(conteo['Zelle'].bs + c.zelle.conteo * rate);
  }
  return conteo;
}

/**
 * Build per-terminal Punto conteo from Cajas lote data.
 * Sums lote monto (Bs) across all operators for each terminal.
 */
function buildPuntoConteoByTerminal(counterData, rate) {
  const map = {};
  for (const c of counterData.counters) {
    for (const l of c.lotes) {
      if (!l.monto || l.monto === 0) continue;
      const key = titleCase(l.terminal);
      if (!map[key]) map[key] = { bs: 0, usd: 0 };
      map[key].bs = round2(map[key].bs + l.monto);
    }
  }
  for (const key of Object.keys(map)) {
    map[key].usd = rate > 0 ? round2(map[key].bs / rate) : 0;
  }
  return map;
}

/**
 * Reconcile Sistema vs Conteo with FAV/NEN allocation.
 * Uses individual methods (same detail as Ordenes Activas).
 *
 * FAV Punto (FAV-only terminal): actual conteo from Cajas lotes.
 * FAV Punto (shared with NEN): conteo = sistema (unchanged).
 * FAV Efectivo Bs: absorbs Punto shortfall from FAV-only terminals.
 * FAV others: conteo = sistema.
 * NEN Punto: terminal conteo minus FAV sistema for that terminal.
 * NEN others: proportional distribution within each type.
 */
export function reconcile(reportData, counterData, bcv) {
  const oa = aggregateOAByType(reportData);
  const conteo = aggregateConteoByType(counterData);
  const rate = counterData.rate || bcv;

  // --- Per-terminal Punto conteo from Cajas lotes ---

  const puntoConteo = buildPuntoConteoByTerminal(counterData, rate);

  // Build per-terminal sistema totals (FAV + NEN combined)
  const terminalSistema = {};
  const allPuntoMethods = [
    ...reportData.fav.methods.filter(m => mapMethodToType(m.metodo) === 'Punto'),
    ...reportData.nen.methods.filter(m => mapMethodToType(m.metodo) === 'Punto'),
  ];
  for (const m of allPuntoMethods) {
    if (!terminalSistema[m.metodo]) terminalSistema[m.metodo] = { bs: 0, usd: 0 };
    terminalSistema[m.metodo].bs = round2(terminalSistema[m.metodo].bs + m.bs);
    terminalSistema[m.metodo].usd = round2(terminalSistema[m.metodo].usd + m.usd);
  }

  // --- Build FAV rows ---

  const favRows = [];
  const totalFav = { sistemaBs: 0, sistemaUsd: 0, conteoBs: 0, conteoUsd: 0, diffUsd: 0 };

  let favPuntoConteoBs = 0;
  let favPuntoConteoUsd = 0;

  for (const m of reportData.fav.methods) {
    const type = mapMethodToType(m.metodo);
    let conteoBs, conteoUsd;

    if (type === 'Punto') {
      const tc = puntoConteo[m.metodo] || { bs: 0, usd: 0 };
      const ts = terminalSistema[m.metodo] || { bs: 0, usd: 0 };
      const hasNEN = round2(ts.usd - m.usd) > 0;

      if (hasNEN) {
        // Terminal shared with NEN: FAV conteo = FAV sistema (unchanged)
        conteoBs = m.bs;
        conteoUsd = m.usd;
      } else {
        // FAV-only terminal: use actual conteo from Cajas lotes
        conteoUsd = tc.usd;
        conteoBs = tc.bs;
      }
      favPuntoConteoUsd = round2(favPuntoConteoUsd + conteoUsd);
      favPuntoConteoBs = round2(favPuntoConteoBs + conteoBs);
    } else {
      // Non-Punto FAV: conteo = sistema (Efectivo Bs adjusted below)
      conteoBs = m.bs;
      conteoUsd = m.usd;
    }

    favRows.push({
      metodo: m.metodo,
      sistemaBs: m.bs,
      sistemaUsd: m.usd,
      conteoBs,
      conteoUsd,
      diffUsd: 0, // placeholder
      isDollar: m.isDollar,
    });
  }

  // Compute Punto shortfall
  const puntoShortfallUsd = round2(oa.fav['Punto'].usd - favPuntoConteoUsd);
  const puntoShortfallBs = round2(oa.fav['Punto'].bs - favPuntoConteoBs);

  // Second pass: apply Punto shortfall to Efectivo Bs and finalize diffs
  for (const r of favRows) {
    const type = mapMethodToType(r.metodo);
    if (type === 'Efectivo Bs' && puntoShortfallUsd > 0) {
      r.conteoUsd = round2(r.sistemaUsd + puntoShortfallUsd);
      r.conteoBs = round2(r.sistemaBs + puntoShortfallBs);
    }
    r.diffUsd = round2(r.conteoUsd - r.sistemaUsd);

    totalFav.sistemaBs = round2(totalFav.sistemaBs + r.sistemaBs);
    totalFav.sistemaUsd = round2(totalFav.sistemaUsd + r.sistemaUsd);
    totalFav.conteoBs = round2(totalFav.conteoBs + r.conteoBs);
    totalFav.conteoUsd = round2(totalFav.conteoUsd + r.conteoUsd);
    totalFav.diffUsd = round2(totalFav.diffUsd + r.diffUsd);
  }

  // --- Type-level NEN allocation (non-Punto types) ---

  const nenConteoByType = {};

  // Standard types: NEN conteo = total conteo − FAV sistema
  for (const type of ['Pago Movil', 'Efectivo $', 'Zelle']) {
    nenConteoByType[type] = {
      usd: round2(conteo[type].usd - oa.fav[type].usd),
      bs: round2(conteo[type].bs - oa.fav[type].bs),
    };
  }

  // Efectivo Bs: NEN conteo = total conteo − FAV conteo (which includes shortfall)
  const favEfBsConteoUsd = round2(oa.fav['Efectivo Bs'].usd + (puntoShortfallUsd > 0 ? puntoShortfallUsd : 0));
  const favEfBsConteoBs = round2(oa.fav['Efectivo Bs'].bs + (puntoShortfallBs > 0 ? puntoShortfallBs : 0));
  nenConteoByType['Efectivo Bs'] = {
    usd: round2(conteo['Efectivo Bs'].usd - favEfBsConteoUsd),
    bs: round2(conteo['Efectivo Bs'].bs - favEfBsConteoBs),
  };

  // --- Build NEN rows ---

  const nenRows = [];
  const totalNen = { sistemaBs: 0, sistemaUsd: 0, conteoBs: 0, conteoUsd: 0, diffUsd: 0 };

  const nenTypesWithRows = new Set();

  // Group NEN methods by payment type
  const nenMethodsByType = {};
  for (const m of reportData.nen.methods) {
    const type = mapMethodToType(m.metodo);
    if (!nenMethodsByType[type]) nenMethodsByType[type] = [];
    nenMethodsByType[type].push(m);
  }

  // NEN Punto: terminal conteo minus FAV sistema for that terminal
  // Build FAV sistema per terminal for subtraction
  const favSistemaByTerminal = {};
  for (const m of reportData.fav.methods) {
    if (mapMethodToType(m.metodo) === 'Punto') {
      favSistemaByTerminal[m.metodo] = { bs: m.bs, usd: m.usd };
    }
  }

  const nenPuntoMethods = nenMethodsByType['Punto'] || [];
  if (nenPuntoMethods.length > 0) {
    nenTypesWithRows.add('Punto');
    for (const m of nenPuntoMethods) {
      const tc = puntoConteo[m.metodo] || { bs: 0, usd: 0 };
      const favSis = favSistemaByTerminal[m.metodo] || { bs: 0, usd: 0 };
      // NEN conteo = terminal conteo − FAV sistema (NEN-only terminals: favSis = 0)
      const conteoUsd = round2(tc.usd - favSis.usd);
      const conteoBs = round2(tc.bs - favSis.bs);
      const diffUsd = round2(conteoUsd - m.usd);

      nenRows.push({
        metodo: m.metodo,
        sistemaBs: m.bs,
        sistemaUsd: m.usd,
        conteoBs,
        conteoUsd,
        diffUsd,
        isDollar: m.isDollar,
      });

      totalNen.sistemaBs = round2(totalNen.sistemaBs + m.bs);
      totalNen.sistemaUsd = round2(totalNen.sistemaUsd + m.usd);
      totalNen.conteoBs = round2(totalNen.conteoBs + conteoBs);
      totalNen.conteoUsd = round2(totalNen.conteoUsd + conteoUsd);
      totalNen.diffUsd = round2(totalNen.diffUsd + diffUsd);
    }
  }

  // NEN non-Punto: proportional distribution within each type
  for (const type of ['Pago Movil', 'Efectivo $', 'Efectivo Bs', 'Zelle']) {
    const methods = nenMethodsByType[type];
    if (!methods || methods.length === 0) continue;

    nenTypesWithRows.add(type);
    const typeSisUsd = methods.reduce((sum, m) => round2(sum + m.usd), 0);
    const typeConteoUsd = nenConteoByType[type].usd;
    const typeConteoBs = nenConteoByType[type].bs;

    for (const m of methods) {
      const share = typeSisUsd > 0 ? m.usd / typeSisUsd : 0;
      const cUsd = round2(typeConteoUsd * share);
      const cBs = round2(typeConteoBs * share);
      const diffUsd = round2(cUsd - m.usd);

      nenRows.push({
        metodo: m.metodo,
        sistemaBs: m.bs,
        sistemaUsd: m.usd,
        conteoBs: cBs,
        conteoUsd: cUsd,
        diffUsd,
        isDollar: m.isDollar,
      });

      totalNen.sistemaBs = round2(totalNen.sistemaBs + m.bs);
      totalNen.sistemaUsd = round2(totalNen.sistemaUsd + m.usd);
      totalNen.conteoBs = round2(totalNen.conteoBs + cBs);
      totalNen.conteoUsd = round2(totalNen.conteoUsd + cUsd);
      totalNen.diffUsd = round2(totalNen.diffUsd + diffUsd);
    }
  }

  // Add NEN rows for types that have conteo but no OA sistema
  for (const type of PAYMENT_TYPES) {
    if (!nenTypesWithRows.has(type)) {
      const nc = type === 'Punto' ? null : nenConteoByType[type];
      if (nc && (nc.usd !== 0 || nc.bs !== 0)) {
        const label = type === 'Efectivo $' ? 'Efectivo $ Tienda'
          : type === 'Efectivo Bs' ? 'Efectivo Bs Tienda'
          : type === 'Pago Movil' ? 'Pago Movil Tienda Venezuela 5187'
          : type;
        nenRows.push({
          metodo: label,
          sistemaBs: 0,
          sistemaUsd: 0,
          conteoBs: nc.bs,
          conteoUsd: nc.usd,
          diffUsd: nc.usd,
          isDollar: type === 'Efectivo $' || type === 'Zelle',
        });
        totalNen.conteoBs = round2(totalNen.conteoBs + nc.bs);
        totalNen.conteoUsd = round2(totalNen.conteoUsd + nc.usd);
        totalNen.diffUsd = round2(totalNen.diffUsd + nc.usd);
      }
    }
  }

  // --- Totals ---

  const total = {
    sistemaBs: round2(totalFav.sistemaBs + totalNen.sistemaBs),
    sistemaUsd: round2(totalFav.sistemaUsd + totalNen.sistemaUsd),
    conteoBs: round2(totalFav.conteoBs + totalNen.conteoBs),
    conteoUsd: round2(totalFav.conteoUsd + totalNen.conteoUsd),
    diffUsd: round2(totalFav.diffUsd + totalNen.diffUsd),
  };

  const roundingAdj = round2(total.conteoUsd - total.sistemaUsd);
  const roundingPct = total.sistemaUsd > 0
    ? round2((Math.abs(roundingAdj) / total.sistemaUsd) * 100)
    : 0;

  return {
    fav: favRows,
    nen: nenRows,
    totalFav,
    totalNen,
    total,
    roundingAdj,
    roundingPct,
    warning: roundingPct > 1,
    puntoShortfallUsd: puntoShortfallUsd > 0 ? puntoShortfallUsd : 0,
    puntoShortfallBs: puntoShortfallBs > 0 ? puntoShortfallBs : 0,
    cajasConteoByType: conteo,
  };
}
