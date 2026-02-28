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
 * Aggregate Cajas conteo by payment type (with opening balance adjustment).
 * If counters array is provided, only those counters are used.
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
 * Sums lote monto (Bs) across operators for each terminal.
 */
function buildPuntoConteoByTerminal(counters, rate) {
  const map = {};
  for (const c of counters) {
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
 * Build FAV reconciliation rows for a single caja.
 * Returns { rows, total, puntoShortfallUsd, puntoShortfallBs }.
 */
function buildCajaFavRows(cajaMethods, cajaPuntoConteo, terminalSistema, favMergedMethods) {
  const rows = [];
  const total = { sistemaBs: 0, sistemaUsd: 0, conteoBs: 0, conteoUsd: 0, diffUsd: 0 };

  let cajaPuntoConteoBs = 0;
  let cajaPuntoConteoUsd = 0;
  let cajaPuntoSisBs = 0;
  let cajaPuntoSisUsd = 0;

  for (const m of cajaMethods) {
    const type = mapMethodToType(m.metodo);
    let conteoBs, conteoUsd;

    if (type === 'Punto') {
      const tc = cajaPuntoConteo[m.metodo] || { bs: 0, usd: 0 };
      const ts = terminalSistema[m.metodo] || { bs: 0, usd: 0 };
      // hasNEN: total sistema for terminal > total FAV sistema for terminal
      const favMerged = favMergedMethods.find(fm => fm.metodo === m.metodo);
      const totalFavSis = favMerged ? favMerged.usd : 0;
      const hasNEN = round2(ts.usd - totalFavSis) > 0;

      if (hasNEN) {
        conteoBs = m.bs;
        conteoUsd = m.usd;
      } else {
        // FAV-only terminal: use actual POS conteo for this caja
        conteoUsd = tc.usd;
        conteoBs = tc.bs;
      }
      cajaPuntoConteoUsd = round2(cajaPuntoConteoUsd + conteoUsd);
      cajaPuntoConteoBs = round2(cajaPuntoConteoBs + conteoBs);
      cajaPuntoSisUsd = round2(cajaPuntoSisUsd + m.usd);
      cajaPuntoSisBs = round2(cajaPuntoSisBs + m.bs);
    } else {
      conteoBs = m.bs;
      conteoUsd = m.usd;
    }

    rows.push({
      metodo: m.metodo,
      sistemaBs: m.bs,
      sistemaUsd: m.usd,
      conteoBs,
      conteoUsd,
      diffUsd: 0,
      isDollar: m.isDollar,
    });
  }

  // Per-caja Punto shortfall
  const puntoShortfallUsd = round2(cajaPuntoSisUsd - cajaPuntoConteoUsd);
  const puntoShortfallBs = round2(cajaPuntoSisBs - cajaPuntoConteoBs);

  // Apply shortfall to Efectivo Bs and finalize diffs
  for (const r of rows) {
    const type = mapMethodToType(r.metodo);
    if (type === 'Efectivo Bs' && puntoShortfallUsd > 0) {
      r.conteoUsd = round2(r.sistemaUsd + puntoShortfallUsd);
      r.conteoBs = round2(r.sistemaBs + puntoShortfallBs);
    }
    r.diffUsd = round2(r.conteoUsd - r.sistemaUsd);

    total.sistemaBs = round2(total.sistemaBs + r.sistemaBs);
    total.sistemaUsd = round2(total.sistemaUsd + r.sistemaUsd);
    total.conteoBs = round2(total.conteoBs + r.conteoBs);
    total.conteoUsd = round2(total.conteoUsd + r.conteoUsd);
    total.diffUsd = round2(total.diffUsd + r.diffUsd);
  }

  return {
    rows,
    total,
    puntoShortfallUsd: puntoShortfallUsd > 0 ? puntoShortfallUsd : 0,
    puntoShortfallBs: puntoShortfallBs > 0 ? puntoShortfallBs : 0,
  };
}

/**
 * Reconcile Sistema vs Conteo with per-caja FAV breakdown.
 *
 * FAV: per-caja sections, each with its own Punto conteo and shortfall.
 * NEN: consolidated across all cajas.
 */
export function reconcile(reportData, counterData, bcv) {
  const conteo = aggregateConteoByType(counterData);
  const rate = counterData.rate || bcv;

  // Per-terminal sistema totals (FAV + NEN combined)
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

  // --- Build FAV rows per caja ---

  const cajaNames = Object.keys(reportData.fav.cajas || {}).sort();
  const favCajas = {};
  const totalFav = { sistemaBs: 0, sistemaUsd: 0, conteoBs: 0, conteoUsd: 0, diffUsd: 0 };

  for (const cajaName of cajaNames) {
    const cajaOA = reportData.fav.cajas[cajaName];
    // Filter counters for this caja
    const cajaCounters = counterData.counters.filter(c => (c.caja || 'CAJA1') === cajaName);
    const cajaPuntoConteo = buildPuntoConteoByTerminal(cajaCounters, rate);

    const cajaResult = buildCajaFavRows(
      cajaOA.methods,
      cajaPuntoConteo,
      terminalSistema,
      reportData.fav.methods, // merged FAV methods for hasNEN check
    );

    favCajas[cajaName] = cajaResult;

    totalFav.sistemaBs = round2(totalFav.sistemaBs + cajaResult.total.sistemaBs);
    totalFav.sistemaUsd = round2(totalFav.sistemaUsd + cajaResult.total.sistemaUsd);
    totalFav.conteoBs = round2(totalFav.conteoBs + cajaResult.total.conteoBs);
    totalFav.conteoUsd = round2(totalFav.conteoUsd + cajaResult.total.conteoUsd);
    totalFav.diffUsd = round2(totalFav.diffUsd + cajaResult.total.diffUsd);
  }

  // Flat fav array (all caja rows combined) for NOTAS verification
  const favRows = [];
  for (const cajaData of Object.values(favCajas)) {
    favRows.push(...cajaData.rows);
  }

  // --- NEN allocation ---
  // NEN conteo = total conteo − sum of all FAV cajas' conteo (per type)

  // Compute total FAV conteo by type from per-caja data
  const favConteoByType = {};
  for (const type of PAYMENT_TYPES) {
    favConteoByType[type] = { bs: 0, usd: 0 };
  }
  for (const cajaData of Object.values(favCajas)) {
    for (const r of cajaData.rows) {
      const type = mapMethodToType(r.metodo);
      favConteoByType[type].bs = round2(favConteoByType[type].bs + r.conteoBs);
      favConteoByType[type].usd = round2(favConteoByType[type].usd + r.conteoUsd);
    }
  }

  // Compute total FAV sistema by type (from merged methods)
  const favSistemaByType = {};
  for (const type of PAYMENT_TYPES) {
    favSistemaByType[type] = { bs: 0, usd: 0 };
  }
  for (const m of reportData.fav.methods) {
    const type = mapMethodToType(m.metodo);
    favSistemaByType[type].bs = round2(favSistemaByType[type].bs + m.bs);
    favSistemaByType[type].usd = round2(favSistemaByType[type].usd + m.usd);
  }

  const nenConteoByType = {};
  for (const type of ['Pago Movil', 'Efectivo $', 'Zelle']) {
    nenConteoByType[type] = {
      usd: round2(conteo[type].usd - favSistemaByType[type].usd),
      bs: round2(conteo[type].bs - favSistemaByType[type].bs),
    };
  }
  // Efectivo Bs: NEN conteo = total conteo − total FAV conteo (includes shortfall)
  nenConteoByType['Efectivo Bs'] = {
    usd: round2(conteo['Efectivo Bs'].usd - favConteoByType['Efectivo Bs'].usd),
    bs: round2(conteo['Efectivo Bs'].bs - favConteoByType['Efectivo Bs'].bs),
  };

  // --- Build NEN rows ---

  const nenRows = [];
  const totalNen = { sistemaBs: 0, sistemaUsd: 0, conteoBs: 0, conteoUsd: 0, diffUsd: 0 };
  const nenTypesWithRows = new Set();

  const nenMethodsByType = {};
  for (const m of reportData.nen.methods) {
    const type = mapMethodToType(m.metodo);
    if (!nenMethodsByType[type]) nenMethodsByType[type] = [];
    nenMethodsByType[type].push(m);
  }

  // NEN Punto: terminal conteo minus FAV sistema for that terminal
  const puntoConteo = buildPuntoConteoByTerminal(counterData.counters, rate);
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
      const cUsd = round2(tc.usd - favSis.usd);
      const cBs = round2(tc.bs - favSis.bs);
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

  // NEN rows for types with conteo but no OA sistema
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
    favCajas,
    fav: favRows,
    nen: nenRows,
    totalFav,
    totalNen,
    total,
    roundingAdj,
    roundingPct,
    warning: roundingPct > 1,
    cajasConteoByType: conteo,
  };
}
