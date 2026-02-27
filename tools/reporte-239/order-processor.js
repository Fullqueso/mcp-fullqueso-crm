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

    // Punto
    if (o.pagoPuntoUsd > 0 || o.pagoPuntoBs > 0) {
      const name = o.punto ? titleCase(o.punto) : 'Sin nombre';
      lines.push({
        orden: o.orden,
        doc: o.doc,
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
    const key = `${l.doc}||${l.metodo}`;
    if (!map.has(key)) {
      map.set(key, {
        doc: l.doc,
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

  const fav = { methods: [], bs: 0, usd: 0, netosiniva: 0, iva: 0, igtf: 0 };
  const nen = { methods: [], bs: 0, usd: 0, netosiniva: 0, iva: 0, igtf: 0 };

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

    const section = entry.doc === 'FAV' ? fav : nen;
    section.methods.push(row);
    section.bs = round2(section.bs + entry.bs);
    section.usd = round2(section.usd + entry.usd);
    section.netosiniva = round2(section.netosiniva + netosiniva);
    section.iva = round2(section.iva + iva);
    section.igtf = round2(section.igtf + igtf);
  }

  fav.methods = sortMethods(fav.methods);
  nen.methods = sortMethods(nen.methods);

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
