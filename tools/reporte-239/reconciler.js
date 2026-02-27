import { round2 } from '../../utils/formatter.js';
import { isDollarMethod } from '../../config/stores.js';

/**
 * Reconcile Ordenes Activas vs Cajas by payment type.
 *
 * Mapping:
 *   Punto (POS)   → OA: sum all punto method USD   → Cajas: sum puntoSisUsd
 *   Pago Móvil    → OA: movil method USD            → Cajas: sum movilSisUsd
 *   Efectivo $    → OA: "Efectivo $ Tienda" USD     → Cajas: sum usdSis
 *   Efectivo Bs   → OA: "Efectivo Bs Tienda" USD    → Cajas: sum vesSisUsd
 *   Zelle         → OA: "Zelle" USD                 → Cajas: sum zelleSis
 */
export function reconcile(reportData, counterData) {
  const { fav, nen } = reportData;
  const allMethods = [...fav.methods, ...nen.methods];

  // Sum OA by payment type
  let oaPunto = 0, oaMovil = 0, oaEfectivoUsd = 0, oaEfectivoBs = 0, oaZelle = 0;

  for (const m of allMethods) {
    if (m.metodo === 'Efectivo $ Tienda') {
      oaEfectivoUsd = round2(oaEfectivoUsd + m.usd);
    } else if (m.metodo === 'Efectivo Bs Tienda') {
      oaEfectivoBs = round2(oaEfectivoBs + m.usd);
    } else if (m.metodo === 'Pago Movil Tienda Venezuela 5187') {
      oaMovil = round2(oaMovil + m.usd);
    } else if (m.metodo === 'Zelle') {
      oaZelle = round2(oaZelle + m.usd);
    } else {
      // All other methods are punto terminals
      oaPunto = round2(oaPunto + m.usd);
    }
  }

  // Sum Cajas by payment type
  let cajaPunto = 0, cajaMovil = 0, cajaUsd = 0, cajaVes = 0, cajaZelle = 0;

  for (const c of counterData.counters) {
    cajaPunto = round2(cajaPunto + c.punto_detail.sistemaUsd);
    cajaMovil = round2(cajaMovil + c.movil.sistemaUsd);
    cajaUsd = round2(cajaUsd + c.usd.sistema);
    cajaVes = round2(cajaVes + c.ves.sistemaUsd);
    cajaZelle = round2(cajaZelle + c.zelle.sistema);
  }

  const comparison = [
    makeRow('Punto (POS)', oaPunto, cajaPunto),
    makeRow('Pago Móvil', oaMovil, cajaMovil),
    makeRow('Efectivo $', oaEfectivoUsd, cajaUsd),
    makeRow('Efectivo Bs', oaEfectivoBs, cajaVes),
    makeRow('Zelle', oaZelle, cajaZelle),
  ];

  const totalOA = round2(oaPunto + oaMovil + oaEfectivoUsd + oaEfectivoBs + oaZelle);
  const totalCaja = round2(cajaPunto + cajaMovil + cajaUsd + cajaVes + cajaZelle);
  const totalDiff = round2(totalOA - totalCaja);
  const pctDiff = totalOA > 0 ? round2((Math.abs(totalDiff) / totalOA) * 100) : 0;

  return {
    comparison,
    totals: {
      ordenesUsd: totalOA,
      cajasUsd: totalCaja,
      diff: totalDiff,
      pctDiff: `${pctDiff.toFixed(2)}%`,
      status: Math.abs(totalDiff) <= 1 ? '✅' : '⚠️',
    },
  };
}

function makeRow(method, ordenesUsd, cajasUsd) {
  const diff = round2(ordenesUsd - cajasUsd);
  return {
    method,
    ordenesUsd,
    cajasUsd,
    diff,
    status: Math.abs(diff) <= 1 ? '✅' : '⚠️',
  };
}
