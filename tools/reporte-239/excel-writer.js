import ExcelJS from 'exceljs';
import { join } from 'path';
import { homedir } from 'os';
import { round2 } from '../../utils/formatter.js';

// ─── Color Constants ─────────────────────────────────────────────────────────

const DARK_RED = { argb: '00CC0000' };
const RED = { argb: '00FF0000' };
const WHITE = { argb: '00FFFFFF' };
const BLUE = { argb: '000000CC' };
const YELLOW_BG = { argb: '00FFF2CC' };
const GREEN_BG = { argb: '00E2EFDA' };
const BLUE_HEADER = { argb: '004472C4' };

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: DARK_RED };
const TOTAL_FILL = { type: 'pattern', pattern: 'solid', fgColor: RED };
const YELLOW_FILL = { type: 'pattern', pattern: 'solid', fgColor: YELLOW_BG };
const GREEN_FILL = { type: 'pattern', pattern: 'solid', fgColor: GREEN_BG };
const BLUE_FILL = { type: 'pattern', pattern: 'solid', fgColor: BLUE_HEADER };

const HEADER_FONT = { bold: true, color: WHITE, size: 10 };
const TOTAL_FONT = { bold: true, color: WHITE, size: 10 };
const BOLD_FONT = { bold: true, size: 10 };
const DOLLAR_FONT = { italic: true, color: BLUE, size: 10 };

const BS_FORMAT = '#,##0.00';
const USD_FORMAT = '$#,##0.00';

/**
 * Generate full Excel report with 3 sheets matching reference format.
 */
export async function generateExcel({ reportData, counterData, reconcileData, date, storeCode, storeName, bcv, orderCount, outputDir }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MCP FullQueso CRM';
  wb.created = new Date();

  writeOrdenesSheet(wb, { reportData, date, storeCode, storeName, bcv, orderCount });
  writeCajasSheet(wb, { counterData, date, storeCode, storeName, bcv });
  writeReconciliacionSheet(wb, { reconcileData, date, storeCode, storeName, bcv });

  const dir = outputDir || join(homedir(), 'Downloads');
  const filename = `Reporte239_${storeCode}_${date}.xlsx`;
  const filepath = join(dir, filename);

  await wb.xlsx.writeFile(filepath);
  return filepath;
}

// ─── Sheet 1: Ordenes Activas ───────────────────────────────────────────────

function writeOrdenesSheet(wb, { reportData, date, storeCode, storeName, bcv, orderCount }) {
  const ws = wb.addWorksheet('Ordenes Activas');

  // Column widths (8 cols)
  const widths = [12, 35, 18, 18, 8, 18, 16, 14];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  // Row 1: Info header with merge
  const infoRow = ws.addRow(['Fecha:', '', date, '', 'Tienda:', storeCode, '', `BCV:`, bcv, `Ordenes: ${orderCount}`]);
  ws.mergeCells('A1:B1');
  infoRow.font = BOLD_FONT;
  infoRow.getCell(9).numFmt = BS_FORMAT;

  // Row 2: Column headers
  const headers = ['CODCAJA', 'METODO_PAGO', 'Suma NETOCIVA Bs', 'Suma NETOCIVAUSD', 'Qty', 'NETOSINIVA', 'IVA', 'IGTF (3%)'];
  const headerRow = ws.addRow(headers);
  headerRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
    if (colNum <= 8) {
      cell.fill = HEADER_FILL;
      cell.font = HEADER_FONT;
      cell.alignment = { horizontal: 'center', wrapText: true };
    }
  });

  // Freeze after row 2
  ws.views = [{ state: 'frozen', ySplit: 2 }];

  const { fav, nen, totals } = reportData;

  // FAV section
  for (const m of fav.methods) {
    writeMethodRow(ws, 'CAJA1', m);
  }
  // Total FAV
  writeSectionTotal(ws, 'Total FAV', fav);

  // NEN section
  for (const m of nen.methods) {
    writeMethodRow(ws, 'NEN', m);
  }
  // Total NEN
  writeSectionTotal(ws, 'Total NEN', nen);

  // Empty row
  ws.addRow([]);

  // TOTAL (FAV+NEN)
  const grandRow = ws.addRow([
    'TOTAL (FAV+NEN)', '',
    totals.bs, totals.usd, '',
    totals.netosiniva, totals.iva, totals.igtf,
  ]);
  applyTotalStyle(grandRow, 8);

  // Apply number formats
  applyOrdenesFormats(ws);
}

function writeMethodRow(ws, codcaja, m) {
  const igtfVal = m.igtf > 0 ? m.igtf : '-';
  const row = ws.addRow([
    codcaja,
    m.metodo,
    m.bs,
    m.usd,
    m.qty,
    m.netosiniva,
    m.iva,
    igtfVal,
  ]);

  if (m.isDollar) {
    // Blue italic for entire row
    row.eachCell({ includeEmpty: true }, (cell, colNum) => {
      if (colNum <= 8) {
        cell.font = DOLLAR_FONT;
        cell.alignment = { horizontal: colNum <= 2 ? 'left' : 'right' };
      }
    });
  } else {
    row.eachCell({ includeEmpty: true }, (cell, colNum) => {
      if (colNum <= 8) {
        cell.alignment = { horizontal: colNum <= 2 ? 'left' : 'right' };
      }
    });
  }
}

function writeSectionTotal(ws, label, section) {
  const row = ws.addRow([
    label, '',
    section.bs, section.usd, '',
    section.netosiniva, section.iva,
    section.igtf > 0 ? section.igtf : '-',
  ]);
  applyTotalStyle(row, 8);
}

function applyTotalStyle(row, numCols) {
  for (let c = 1; c <= numCols; c++) {
    const cell = row.getCell(c);
    cell.fill = TOTAL_FILL;
    cell.font = TOTAL_FONT;
    cell.alignment = { horizontal: c <= 2 ? 'left' : 'right' };
  }
}

function applyOrdenesFormats(ws) {
  ws.eachRow((row, rowNum) => {
    if (rowNum <= 2) return;
    // Col 3 (NETOCIVA Bs), Col 6 (NETOSINIVA), Col 7 (IVA), Col 8 (IGTF) = Bs format
    [3, 6, 7, 8].forEach(col => {
      const cell = row.getCell(col);
      if (typeof cell.value === 'number') cell.numFmt = BS_FORMAT;
    });
    // Col 4 (NETOCIVAUSD) = USD format
    const usdCell = row.getCell(4);
    if (typeof usdCell.value === 'number') usdCell.numFmt = USD_FORMAT;
  });
}

// ─── Sheet 2: Cajas ─────────────────────────────────────────────────────────

function writeCajasSheet(wb, { counterData, date, storeCode, storeName, bcv }) {
  const ws = wb.addWorksheet('Cajas');

  // Column widths (9 cols)
  const widths = [18, 14, 12, 16, 16, 16, 16, 16, 16];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  // Row 1: Title merged
  const title = `Cajas - ${storeCode} - ${date}`;
  const titleRow = ws.addRow([title]);
  ws.mergeCells('A1:H1');
  titleRow.font = BOLD_FONT;

  // Row 2: empty
  ws.addRow([]);

  // Row 3: Headers
  const headers = ['Operador', 'Nombre', 'Terminal', 'Tipo', 'Sistema Bs', 'Sistema USD', 'Conteo Bs', 'Conteo USD', 'Diferencia USD'];
  const headerRow = ws.addRow(headers);
  headerRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
    if (colNum <= 9) {
      cell.fill = HEADER_FILL;
      cell.font = HEADER_FONT;
      cell.alignment = { horizontal: 'center' };
    }
  });

  // Freeze after row 3
  ws.views = [{ state: 'frozen', ySplit: 3 }];

  const rate = counterData.rate || bcv;
  let totalSistemaUsd = 0;
  let totalConteoUsd = 0;

  // Expand each counter into rows per payment type
  for (const c of counterData.counters) {
    const rows = expandCounterRows(c, rate);
    for (const r of rows) {
      const dataRow = ws.addRow([
        r.operador, r.nombre, r.terminal, r.tipo,
        r.sistemaBs, r.sistemaUsd, r.conteoBs, r.conteoUsd, r.diffUsd,
      ]);
      applyDataRowStyle(dataRow);
      totalSistemaUsd += r.sistemaUsd || 0;
      totalConteoUsd += r.conteoUsd || 0;
    }
  }

  // Empty row
  ws.addRow([]);

  // Total row (yellow background)
  const totalDiff = round2(totalConteoUsd - totalSistemaUsd);
  const totalRow = ws.addRow([
    'TOTAL CAJAS', '', '', '', '',
    round2(totalSistemaUsd), '',
    round2(totalConteoUsd), round2(totalDiff),
  ]);
  for (let col = 1; col <= 9; col++) {
    const cell = totalRow.getCell(col);
    cell.fill = YELLOW_FILL;
    cell.font = BOLD_FONT;
    cell.alignment = { horizontal: col <= 4 ? 'left' : 'right' };
    if ([6, 8, 9].includes(col) && typeof cell.value === 'number') {
      cell.numFmt = USD_FORMAT;
    }
  }

  // Empty row
  ws.addRow([]);

  // DETALLE DE LOTES section
  const loteLabel = ws.addRow(['DETALLE DE LOTES']);
  loteLabel.font = BOLD_FONT;

  const loteHeaders = ['Operador', 'Terminal', 'Lote', 'Monto Bs', 'Monto USD'];
  const loteHeaderRow = ws.addRow(loteHeaders);
  loteHeaderRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
    if (colNum <= 5) {
      cell.fill = BLUE_FILL;
      cell.font = HEADER_FONT;
    }
  });

  // Lote data (skip zero-amount lotes)
  for (const c of counterData.counters) {
    for (const l of c.lotes) {
      if (!l.monto || l.monto === 0) continue;
      const montoUsd = rate > 0 ? round2(l.monto / rate) : 0;
      const loteRow = ws.addRow([
        c.operatorCode || c.operator, l.terminal, l.lote, l.monto, montoUsd,
      ]);
      loteRow.getCell(1).alignment = { horizontal: 'left' };
      loteRow.getCell(2).alignment = { horizontal: 'left' };
      loteRow.getCell(3).alignment = { horizontal: 'right' };
      loteRow.getCell(4).numFmt = BS_FORMAT;
      loteRow.getCell(4).alignment = { horizontal: 'right' };
      loteRow.getCell(5).numFmt = USD_FORMAT;
      loteRow.getCell(5).alignment = { horizontal: 'right' };
    }
  }

  // Apply number formats to data rows
  applyDataFormats(ws, 4);
}

function expandCounterRows(c, rate) {
  const rows = [];
  const opCode = c.operatorCode || c.operator;
  const opName = c.operator;

  // Punto row (if punto data exists)
  if (c.punto_detail.sistemaUsd > 0 || c.punto_detail.sistemaBs > 0) {
    rows.push({
      operador: opCode,
      nombre: opName,
      terminal: c.punto,
      tipo: 'Punto',
      sistemaBs: c.punto_detail.sistemaBs,
      sistemaUsd: c.punto_detail.sistemaUsd,
      conteoBs: c.punto_detail.conteoBs,
      conteoUsd: c.punto_detail.conteoUsd,
      diffUsd: round2(c.punto_detail.conteoUsd - c.punto_detail.sistemaUsd),
    });
  }

  // Efectivo Bs row (subtract opening Bs balance from conteo)
  if (c.ves.sistema > 0 || c.ves.conteo > 0) {
    const sistemaUsd = rate > 0 ? round2(c.ves.sistema / rate) : 0;
    const adjustedVesConteo = round2(c.ves.conteo - c.efectivoBs);
    const conteoUsd = rate > 0 ? round2(adjustedVesConteo / rate) : 0;
    rows.push({
      operador: opCode,
      nombre: opName,
      terminal: '',
      tipo: 'Efectivo Bs',
      sistemaBs: c.ves.sistema,
      sistemaUsd,
      conteoBs: adjustedVesConteo,
      conteoUsd,
      diffUsd: round2(conteoUsd - sistemaUsd),
    });
  }

  // Efectivo $ row (subtract opening USD balance from conteo)
  if (c.usd.sistema > 0 || c.usd.conteo > 0) {
    const adjustedUsdConteo = round2(c.usd.conteo - c.efectivoUsd);
    rows.push({
      operador: opCode,
      nombre: opName,
      terminal: '',
      tipo: 'Efectivo $',
      sistemaBs: 0,
      sistemaUsd: c.usd.sistema,
      conteoBs: 0,
      conteoUsd: adjustedUsdConteo,
      diffUsd: round2(adjustedUsdConteo - c.usd.sistema),
    });
  }

  // Pago Movil row
  if (c.movil.sistemaUsd > 0 || c.movil.sistemaBs > 0) {
    rows.push({
      operador: opCode,
      nombre: opName,
      terminal: '',
      tipo: 'Pago Movil',
      sistemaBs: c.movil.sistemaBs,
      sistemaUsd: c.movil.sistemaUsd,
      conteoBs: c.movil.conteoBs,
      conteoUsd: c.movil.conteoUsd,
      diffUsd: round2(c.movil.conteoUsd - c.movil.sistemaUsd),
    });
  }

  // Zelle row
  if (c.zelle.sistema > 0 || c.zelle.conteo > 0) {
    rows.push({
      operador: opCode,
      nombre: opName,
      terminal: '',
      tipo: 'Zelle',
      sistemaBs: 0,
      sistemaUsd: c.zelle.sistema,
      conteoBs: 0,
      conteoUsd: c.zelle.conteo,
      diffUsd: round2(c.zelle.conteo - c.zelle.sistema),
    });
  }

  return rows;
}

function applyDataRowStyle(row) {
  row.eachCell({ includeEmpty: true }, (cell, colNum) => {
    if (colNum <= 4) {
      cell.alignment = { horizontal: colNum <= 2 ? 'left' : 'right' };
    } else if (colNum <= 9) {
      cell.alignment = { horizontal: 'right' };
    }
  });
}

function applyDataFormats(ws, startRow) {
  ws.eachRow((row, rowNum) => {
    if (rowNum < startRow) return;
    // Cols 5,7 = Bs format; Cols 6,8,9 = USD format
    [5, 7].forEach(col => {
      const cell = row.getCell(col);
      if (typeof cell.value === 'number') cell.numFmt = BS_FORMAT;
    });
    [6, 8, 9].forEach(col => {
      const cell = row.getCell(col);
      if (typeof cell.value === 'number') cell.numFmt = USD_FORMAT;
    });
  });
}

// ─── Sheet 3: Reconciliación ────────────────────────────────────────────────

function writeReconciliacionSheet(wb, { reconcileData, date, storeCode, storeName, bcv }) {
  const ws = wb.addWorksheet('Reconciliación');

  // Column widths (7 cols)
  const widths = [12, 20, 18, 18, 18, 18, 18];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  // Row 1: Title merged
  const title = `RECONCILIACIÓN SISTEMA vs CONTEO — ${storeCode} — ${date}`;
  const titleRow = ws.addRow([title]);
  ws.mergeCells('A1:G1');
  titleRow.getCell(1).font = { bold: true, color: DARK_RED, size: 10 };

  // Row 2: empty
  ws.addRow([]);

  // Row 3: Headers
  const headers = ['CODCAJA', 'Forma de Pago', 'Sistema Bs', 'Sistema USD', 'Conteo Bs', 'Conteo USD', 'Diferencia USD'];
  const headerRow = ws.addRow(headers);
  headerRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
    if (colNum <= 7) {
      cell.fill = HEADER_FILL;
      cell.font = HEADER_FONT;
      cell.alignment = { horizontal: 'center', wrapText: true };
    }
  });

  // Freeze after row 3
  ws.views = [{ state: 'frozen', ySplit: 3 }];

  // FAV section
  for (const r of reconcileData.fav) {
    writeReconcileRow(ws, 'FAV', r);
  }
  // Total FAV
  writeReconcileTotalRow(ws, 'Total FAV', reconcileData.totalFav);

  // NEN section
  for (const r of reconcileData.nen) {
    writeReconcileRow(ws, 'NEN', r);
  }
  // Total NEN
  writeReconcileTotalRow(ws, 'Total NEN', reconcileData.totalNen);

  // Empty row
  ws.addRow([]);

  // TOTAL row (yellow)
  const t = reconcileData.total;
  const grandRow = ws.addRow([
    'TOTAL', '', t.sistemaBs, t.sistemaUsd, t.conteoBs, t.conteoUsd, t.diffUsd,
  ]);
  for (let col = 1; col <= 7; col++) {
    const cell = grandRow.getCell(col);
    cell.fill = YELLOW_FILL;
    cell.font = BOLD_FONT;
    cell.alignment = { horizontal: col <= 2 ? 'left' : 'right' };
  }
  applyReconcileFormats(grandRow);

  // Rounding Adjustment row
  const adjRow = ws.addRow([
    'Ajuste Redondeo', '', '', '', '', reconcileData.roundingAdj, '',
  ]);
  for (let col = 1; col <= 7; col++) {
    const cell = adjRow.getCell(col);
    cell.font = { bold: true, italic: true, size: 10 };
    cell.alignment = { horizontal: col <= 2 ? 'left' : 'right' };
  }
  adjRow.getCell(6).numFmt = USD_FORMAT;

  // Empty row
  ws.addRow([]);

  // NOTAS section
  const notasRow = ws.addRow(['NOTAS:']);
  notasRow.font = BOLD_FONT;

  const notes = [];

  // General rules
  notes.push('REGLAS DE RECONCILIACIÓN:');
  notes.push('• FAV Punto: conteo real por terminal desde lotes de Cajas');
  notes.push('• FAV otros métodos: conteo = sistema');
  notes.push('• NEN absorbe todas las diferencias de conteo');
  notes.push(`• Tasa BCV usada: ${bcv}`);
  notes.push('');

  // Detail FAV adjustments
  const favAdj = reconcileData.fav.filter(r => r.diffUsd !== 0);
  if (favAdj.length > 0) {
    notes.push('AJUSTES FAV:');
    for (const r of favAdj) {
      const sign = r.diffUsd > 0 ? '+' : '';
      notes.push(`• ${r.metodo}: conteo ${sign}$${r.diffUsd.toFixed(2)} (Bs ${sign}${round2(r.conteoBs - r.sistemaBs).toFixed(2)}) vs sistema`);
    }
    if (reconcileData.puntoShortfallUsd > 0) {
      notes.push(`  → Déficit Punto total: $${reconcileData.puntoShortfallUsd.toFixed(2)} (Bs ${reconcileData.puntoShortfallBs.toFixed(2)}) absorbido en Efectivo Bs Tienda FAV`);
    }
    notes.push(`• Total FAV Diferencia: $${reconcileData.totalFav.diffUsd.toFixed(2)}`);
    notes.push('');
  }

  // Detail NEN adjustments
  const nenAdj = reconcileData.nen.filter(r => r.diffUsd !== 0);
  if (nenAdj.length > 0) {
    notes.push('AJUSTES NEN:');
    for (const r of nenAdj) {
      const sign = r.diffUsd > 0 ? '+' : '';
      notes.push(`• ${r.metodo}: conteo ${sign}$${r.diffUsd.toFixed(2)} (Bs ${sign}${round2(r.conteoBs - r.sistemaBs).toFixed(2)}) vs sistema`);
    }
    notes.push(`• Total NEN Diferencia: $${reconcileData.totalNen.diffUsd.toFixed(2)}`);
    notes.push('');
  }

  // Rounding
  notes.push(`AJUSTE REDONDEO: $${reconcileData.roundingAdj.toFixed(2)} (${reconcileData.roundingPct.toFixed(2)}%)`);
  notes.push('');

  // Verification: Efectivo Bs/$ reconciliation totals vs Cajas adjusted conteo
  if (reconcileData.cajasConteoByType) {
    const allRows = [...reconcileData.fav, ...reconcileData.nen];

    const checks = [
      { label: 'Efectivo Bs', metodo: 'Efectivo Bs Tienda', type: 'Efectivo Bs' },
      { label: 'Efectivo $', metodo: 'Efectivo $ Tienda', type: 'Efectivo $' },
      { label: 'Pago Movil', metodo: 'Pago Movil Tienda Venezuela 5187', type: 'Pago Movil' },
      { label: 'Zelle', metodo: 'Zelle', type: 'Zelle' },
    ];

    notes.push('VERIFICACIÓN CONTEO vs CAJAS:');
    for (const chk of checks) {
      const reconUsd = round2(allRows
        .filter(r => r.metodo === chk.metodo)
        .reduce((sum, r) => sum + r.conteoUsd, 0));
      const cajasUsd = reconcileData.cajasConteoByType[chk.type]?.usd || 0;
      const diff = round2(reconUsd - cajasUsd);
      const status = Math.abs(diff) <= 0.01 ? '✅' : `❌ diff $${diff.toFixed(2)}`;
      notes.push(`• ${chk.label}: Recon $${reconUsd.toFixed(2)} vs Cajas $${cajasUsd.toFixed(2)} ${status}`);
    }

    // Punto verification (sum all Punto terminals)
    const reconPuntoUsd = round2(allRows
      .filter(r => !['Efectivo Bs Tienda', 'Efectivo $ Tienda', 'Pago Movil Tienda Venezuela 5187', 'Zelle'].includes(r.metodo))
      .reduce((sum, r) => sum + r.conteoUsd, 0));
    const cajasPuntoUsd = reconcileData.cajasConteoByType['Punto']?.usd || 0;
    const puntoDiff = round2(reconPuntoUsd - cajasPuntoUsd);
    const puntoStatus = Math.abs(puntoDiff) <= 0.01 ? '✅' : `❌ diff $${puntoDiff.toFixed(2)}`;
    notes.push(`• Punto (todos): Recon $${reconPuntoUsd.toFixed(2)} vs Cajas $${cajasPuntoUsd.toFixed(2)} ${puntoStatus}`);
    notes.push('');
  }

  if (reconcileData.warning) {
    notes.push('⚠️ ALERTA: Ajuste de redondeo supera 1% — revisar conteo');
  }

  for (const note of notes) {
    if (note === '') {
      ws.addRow([]);
      continue;
    }
    const noteRow = ws.addRow([note]);
    const rowNum = noteRow.number;
    ws.mergeCells(`A${rowNum}:G${rowNum}`);
    if (note.startsWith('⚠️')) {
      noteRow.getCell(1).font = { bold: true, color: RED, size: 10 };
    } else if (!note.startsWith('•') && note.endsWith(':')) {
      noteRow.getCell(1).font = BOLD_FONT;
    }
  }
}

function writeReconcileRow(ws, codcaja, r) {
  const row = ws.addRow([
    codcaja, r.metodo, r.sistemaBs, r.sistemaUsd, r.conteoBs, r.conteoUsd, r.diffUsd,
  ]);
  for (let col = 1; col <= 7; col++) {
    const cell = row.getCell(col);
    cell.fill = GREEN_FILL;
    cell.alignment = { horizontal: col <= 2 ? 'left' : 'right' };
    if (r.isDollar) {
      cell.font = DOLLAR_FONT;
    }
  }
  applyReconcileFormats(row);
}

function writeReconcileTotalRow(ws, label, totals) {
  const row = ws.addRow([
    label, '', totals.sistemaBs, totals.sistemaUsd, totals.conteoBs, totals.conteoUsd, totals.diffUsd,
  ]);
  applyTotalStyle(row, 7);
  applyReconcileFormats(row);
}

function applyReconcileFormats(row) {
  // Cols 3,5 = Bs format; Cols 4,6,7 = USD format
  [3, 5].forEach(col => {
    if (typeof row.getCell(col).value === 'number') row.getCell(col).numFmt = BS_FORMAT;
  });
  [4, 6, 7].forEach(col => {
    if (typeof row.getCell(col).value === 'number') row.getCell(col).numFmt = USD_FORMAT;
  });
}
