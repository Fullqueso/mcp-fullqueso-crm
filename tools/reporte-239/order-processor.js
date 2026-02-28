import { round2, titleCase } from '../../utils/formatter.js';
import { METHOD_SORT_ORDER, METHOD_SORT_AFTER, isDollarMethod, isIGTFAgent } from '../../config/stores.js';

/**
 * Derive BCV rate from order data.
 * Uses pagoPuntoBs/pagoPuntoUsd from the first order where both > 0.
 * Fallback: pagoMovilBs/pagoMovilUsd.
 */
export function deriveBCV(orders) {
  // Try punto first
  for (const o of orders) {
    if (o.pagoPuntoUsd > 0 && o.pagoPuntoBs > 0) {
      return round2(o.pagoPuntoBs / o.pagoPuntoUsd);
    }
  }
  // Fallback: pago movil
  for (const o of orders) {
    if (o.pagoMovilUsd > 0 && o.pagoMovilBs > 0) {
      return round2(o.pagoMovilBs / o.pagoMovilUsd);
    }
  }
  throw new Error('Cannot derive BCV rate: no punto or movil data with both Bs and USD > 0');
}

/**
 * Decompose each order into payment method lines.
 * Skips doc === "BC" orders.
 */
export function decomposePayments(orders, bcv) {
  const lines = [];

  for (const o of orders) {
    if (o.doc === 'BC') continue;

    const caja = o.caja || 'CAJA1';

    // Punto
    if (o.pagoPuntoUsd > 0 || o.pagoPuntoBs > 0) {
      const name = o.punto ? titleCase(o.punto) : 'Sin nombre';
      lines.push({
        orden: o.orden,
        doc: o.doc,
        caja,
        metodo: name,
        bs: round2(o.pagoPuntoBs || 0),
        usd: round2(o.pagoPuntoUsd || 0),
        isDollar: false,
      });
    }

    // Pago Movil
    if (o.pagoMovilUsd > 0 || o.pagoMovilBs > 0) {
      lines.push({
        orden: o.orden,
        doc: o.doc,
        caja,
        metodo: 'Pago Movil Tienda Venezuela 5187',
        bs: round2(o.pagoMovilBs || 0),
        usd: round2(o.pagoMovilUsd || 0),
        isDollar: false,
      });
    }

    // Cash USD (net = cash - cashVuelto)
    const cashNet = round2((o.cash || 0) - (o.cashVuelto || 0));
    if (cashNet > 0) {
      lines.push({
        orden: o.orden,
        doc: o.doc,
        caja,
        metodo: 'Efectivo $ Tienda',
        bs: round2(cashNet * bcv),
        usd: cashNet,
        isDollar: true,
      });
    }

    // Efectivo Bs
    const efBsNet = round2((o.pagoEfectivoBs || 0) - (o.pagoEfectivoBsVuelto || 0));
    if (efBsNet > 0) {
      lines.push({
        orden: o.orden,
        doc: o.doc,
        caja,
        metodo: 'Efectivo Bs Tienda',
        bs: round2(efBsNet),
        usd: round2(efBsNet / bcv),
        isDollar: false,
      });
    }

    // Zelle
    if (o.zelle > 0) {
      lines.push({
        orden: o.orden,
        doc: o.doc,
        caja,
        metodo: 'Zelle',
        bs: round2(o.zelle * bcv),
        usd: round2(o.zelle),
        isDollar: true,
      });
    }
  }

  return lines;
}

/**
 * Aggregate lines by (doc, metodo) → sum bs, usd.
 */
export function aggregate(lines) {
  const map = new Map();

  for (const l of lines) {
    // FAV: group by (doc, caja, metodo) for per-caja sections
    // NEN: group by (doc, metodo) — consolidated across cajas
    const key = l.doc === 'FAV'
      ? `${l.doc}||${l.caja || 'CAJA1'}||${l.metodo}`
      : `${l.doc}||${l.metodo}`;
    if (!map.has(key)) {
      map.set(key, {
        doc: l.doc,
        caja: l.doc === 'FAV' ? (l.caja || 'CAJA1') : undefined,
        metodo: l.metodo,
        bs: 0,
        usd: 0,
        qty: 0,
        isDollar: l.isDollar,
      });
    }
    const entry = map.get(key);
    entry.bs = round2(entry.bs + l.bs);
    entry.usd = round2(entry.usd + l.usd);
    entry.qty += 1;
  }

  return Array.from(map.values());
}

/**
 * Sort methods by fixed order + dynamic puntos + fixed after.
 */
export function sortMethods(methods) {
  return methods.sort((a, b) => {
    const idxA = getMethodIndex(a.metodo);
    const idxB = getMethodIndex(b.metodo);
    if (idxA !== idxB) return idxA - idxB;
    // Same bucket → alphabetical
    return a.metodo.localeCompare(b.metodo);
  });
}

function getMethodIndex(metodo) {
  const fixedIdx = METHOD_SORT_ORDER.indexOf(metodo);
  if (fixedIdx >= 0) return fixedIdx;

  const afterIdx = METHOD_SORT_AFTER.indexOf(metodo);
  if (afterIdx >= 0) return 1000 + afterIdx;

  // Dynamic punto → middle bucket
  return 500;
}

/**
 * Calculate derived columns: netosiniva, iva, igtf.
 * Returns { fav, nen, totals, verification } structure.
 */
export function calculateTotals(aggregated, storeCode, bcv) {
  const igtfAgent = isIGTFAgent(storeCode);

  const fav = { methods: [], cajas: {}, bs: 0, usd: 0, netosiniva: 0, iva: 0, igtf: 0 };
  const nen = { methods: [], bs: 0, usd: 0, netosiniva: 0, iva: 0, igtf: 0 };

  // Accumulator for merged FAV methods (one entry per metodo, across all cajas)
  const favMerged = new Map();

  for (const entry of aggregated) {
    const dollar = isDollarMethod(entry.metodo);
    const netosiniva = round2(entry.bs / 1.16);
    const iva = round2(entry.bs - netosiniva);
    const igtf = (entry.doc === 'FAV' && dollar && igtfAgent)
      ? round2(entry.usd * 0.03 * bcv)
      : 0;

    const row = {
      metodo: entry.metodo,
      bs: entry.bs,
      usd: entry.usd,
      qty: entry.qty,
      netosiniva,
      iva,
      igtf,
      isDollar: dollar,
    };

    if (entry.doc === 'FAV') {
      fav.bs = round2(fav.bs + entry.bs);
      fav.usd = round2(fav.usd + entry.usd);
      fav.netosiniva = round2(fav.netosiniva + netosiniva);
      fav.iva = round2(fav.iva + iva);
      fav.igtf = round2(fav.igtf + igtf);

      // Merge by metodo for reconciler (combines cajas)
      if (!favMerged.has(entry.metodo)) {
        favMerged.set(entry.metodo, { metodo: entry.metodo, bs: 0, usd: 0, qty: 0, netosiniva: 0, iva: 0, igtf: 0, isDollar: dollar });
      }
      const merged = favMerged.get(entry.metodo);
      merged.bs = round2(merged.bs + entry.bs);
      merged.usd = round2(merged.usd + entry.usd);
      merged.qty += entry.qty;
      merged.netosiniva = round2(merged.netosiniva + netosiniva);
      merged.iva = round2(merged.iva + iva);
      merged.igtf = round2(merged.igtf + igtf);

      // Per-caja grouping for Excel
      const cajaName = entry.caja || 'CAJA1';
      if (!fav.cajas[cajaName]) {
        fav.cajas[cajaName] = { methods: [], bs: 0, usd: 0, netosiniva: 0, iva: 0, igtf: 0 };
      }
      const cajaSection = fav.cajas[cajaName];
      cajaSection.methods.push(row);
      cajaSection.bs = round2(cajaSection.bs + entry.bs);
      cajaSection.usd = round2(cajaSection.usd + entry.usd);
      cajaSection.netosiniva = round2(cajaSection.netosiniva + netosiniva);
      cajaSection.iva = round2(cajaSection.iva + iva);
      cajaSection.igtf = round2(cajaSection.igtf + igtf);
    } else {
      nen.methods.push(row);
      nen.bs = round2(nen.bs + entry.bs);
      nen.usd = round2(nen.usd + entry.usd);
      nen.netosiniva = round2(nen.netosiniva + netosiniva);
      nen.iva = round2(nen.iva + iva);
      nen.igtf = round2(nen.igtf + igtf);
    }
  }

  // fav.methods = merged across cajas (one entry per metodo) — used by reconciler
  fav.methods = sortMethods(Array.from(favMerged.values()));
  nen.methods = sortMethods(nen.methods);

  // Sort methods within each caja
  for (const cajaSection of Object.values(fav.cajas)) {
    cajaSection.methods = sortMethods(cajaSection.methods);
  }

  const totals = {
    bs: round2(fav.bs + nen.bs),
    usd: round2(fav.usd + nen.usd),
    netosiniva: round2(fav.netosiniva + nen.netosiniva),
    iva: round2(fav.iva + nen.iva),
    igtf: round2(fav.igtf + nen.igtf),
  };

  // Verification: NETOCIVA/BCV vs NETOCIVAUSD
  const netocivaViaBcv = round2(totals.bs / bcv);
  const verification = {
    netoviaBcv: netocivaViaBcv,
    netocivaUsd: totals.usd,
    diff: round2(totals.usd - netocivaViaBcv),
  };

  return { fav, nen, totals, verification };
}
