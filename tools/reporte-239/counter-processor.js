import { round2 } from '../../utils/formatter.js';

/**
 * Process raw counter data into structured per-operator detail.
 */
export function processCounters(countersData) {
  const { counters, date, shopCode } = countersData;
  const rate = counters[0]?.rate || 0;

  const processed = counters.map(c => {
    // Extract lote detail from puntosConteo
    const lotes = [];
    if (c.puntosConteo) {
      for (const [terminal, detail] of Object.entries(c.puntosConteo)) {
        if (detail.lotes && Array.isArray(detail.lotes)) {
          for (const l of detail.lotes) {
            lotes.push({
              terminal,
              lote: l.lote,
              monto: round2(l.monto || 0),
            });
          }
        }
      }
    }

    return {
      operator: c.operatorName,
      operatorCode: c.operatorCode,
      punto: c.punto || '',
      caja: c.caja || '',
      efectivoBs: round2(c.efectivoBs || 0),
      efectivoUsd: round2(c.efectivoUsd || 0),
      ves: {
        sistema: round2(c.vesSis || 0),
        sistemaUsd: round2(c.vesSisUsd || 0),
        conteo: round2(c.vesConteo || 0),
        conteoUsd: round2(c.vesConteoUsd || 0),
        diff: round2(c.vesDif || 0),
      },
      usd: {
        sistema: round2(c.usdSis || 0),
        conteo: round2(c.usdConteo || 0),
        diff: round2(c.usdDif || 0),
      },
      punto_detail: {
        sistemaUsd: round2(c.puntoSisUsd || 0),
        sistemaBs: round2(c.puntoSis || 0),
        conteoUsd: round2(c.puntoConteoUsd || 0),
        conteoBs: round2(c.puntoConteoBs || 0),
        diffUsd: round2(c.puntoDifUsd || 0),
        diffBs: round2(c.puntoDif || 0),
      },
      movil: {
        sistemaBs: round2(c.movilSis || 0),
        sistemaUsd: round2(c.movilSisUsd || 0),
        conteoBs: round2(c.movilConteoBs || 0),
        conteoUsd: round2(c.movilConteoUsd || 0),
        diffUsd: round2(c.movilDifUsd || 0),
      },
      zelle: {
        sistema: round2(c.zelleSis || 0),
        conteo: round2(c.zelleConteo || 0),
        diff: round2(c.zelleDif || 0),
      },
      totalUsd: {
        sistema: round2(c.totalSisUsd || 0),
        conteo: round2(c.totalConteoUsd || 0),
        diff: round2(c.totalDif || 0),
      },
      porcentajeDiferencia: c.porcentajeDiferencia || 0,
      cerradoPor: c.cerradoPor || '',
      lotes,
    };
  });

  return { date, shopCode, rate, counters: processed };
}

/**
 * Calculate grand totals across all operators.
 */
export function calculateGrandTotals(processedCounters) {
  const totals = {
    vesSistema: 0,
    vesSistemaUsd: 0,
    vesConteo: 0,
    vesConteoUsd: 0,
    usdSistema: 0,
    usdConteo: 0,
    puntoSistemaUsd: 0,
    puntoConteoUsd: 0,
    movilSistemaUsd: 0,
    movilConteoUsd: 0,
    zelleSistema: 0,
    zelleConteo: 0,
    totalSistemaUsd: 0,
    totalConteoUsd: 0,
    totalDiff: 0,
  };

  for (const c of processedCounters) {
    totals.vesSistema = round2(totals.vesSistema + c.ves.sistema);
    totals.vesSistemaUsd = round2(totals.vesSistemaUsd + c.ves.sistemaUsd);
    totals.vesConteo = round2(totals.vesConteo + c.ves.conteo);
    totals.vesConteoUsd = round2(totals.vesConteoUsd + c.ves.conteoUsd);
    totals.usdSistema = round2(totals.usdSistema + c.usd.sistema);
    totals.usdConteo = round2(totals.usdConteo + c.usd.conteo);
    totals.puntoSistemaUsd = round2(totals.puntoSistemaUsd + c.punto_detail.sistemaUsd);
    totals.puntoConteoUsd = round2(totals.puntoConteoUsd + c.punto_detail.conteoUsd);
    totals.movilSistemaUsd = round2(totals.movilSistemaUsd + c.movil.sistemaUsd);
    totals.movilConteoUsd = round2(totals.movilConteoUsd + c.movil.conteoUsd);
    totals.zelleSistema = round2(totals.zelleSistema + c.zelle.sistema);
    totals.zelleConteo = round2(totals.zelleConteo + c.zelle.conteo);
    totals.totalSistemaUsd = round2(totals.totalSistemaUsd + c.totalUsd.sistema);
    totals.totalConteoUsd = round2(totals.totalConteoUsd + c.totalUsd.conteo);
    totals.totalDiff = round2(totals.totalDiff + c.totalUsd.diff);
  }

  return {
    sistemaUsd: totals.totalSistemaUsd,
    conteoUsd: totals.totalConteoUsd,
    diffUsd: round2(totals.totalSistemaUsd - totals.totalConteoUsd),
    detail: totals,
  };
}
