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

  // Efectivo Bs row
  if (c.ves.sistema > 0 || c.ves.conteo > 0) {
    const sistemaUsd = rate > 0 ? round2(c.ves.sistema / rate) : 0;
    const conteoUsd = rate > 0 ? round2(c.ves.conteo / rate) : 0;
    rows.push({
      operador: opCode,
      nombre: opName,
      terminal: '',
      tipo: 'Efectivo Bs',
      sistemaBs: c.ves.sistema,
      sistemaUsd,
      conteoBs: c.ves.conteo,
      conteoUsd,
      diffUsd: round2(conteoUsd - sistemaUsd),
    });
  }

  // Efectivo $ row
  if (c.usd.sistema > 0 || c.usd.conteo > 0) {
    rows.push({
      operador: opCode,
      nombre: opName,
      terminal: '',
      tipo: 'Efectivo $',
      sistemaBs: 0,
      sistemaUsd: c.usd.sistema,
      conteoBs: 0,
      conteoUsd: c.usd.conteo,
      diffUsd: round2(c.usd.conteo - c.usd.sistema),
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

  // Column widths (6 cols)
  const widths = [22, 22, 22, 22, 14, 12];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  // Row 1: Title merged
  const title = `RECONCILIACIÓN ORDENES ACTIVAS vs CAJAS — ${storeCode} — ${date}`;
  const titleRow = ws.addRow([title]);
  ws.mergeCells('A1:F1');
  titleRow.getCell(1).font = { bold: true, color: DARK_RED, size: 10 };

  // Row 2: empty
  ws.addRow([]);

  // Row 3: Headers
  const headers = ['Forma de Pago', 'Ordenes Activas USD', 'Cajas (Sistema) USD', 'Diferencia USD', 'Diferencia %', 'Status'];
  const headerRow = ws.addRow(headers);
  headerRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
    if (colNum <= 6) {
      cell.fill = HEADER_FILL;
      cell.font = HEADER_FONT;
      cell.alignment = { horizontal: 'center' };
    }
  });

  // Freeze after row 3
  ws.views = [{ state: 'frozen', ySplit: 3 }];

  // Data rows with green background
  for (const c of reconcileData.comparison) {
    const pct = c.ordenesUsd > 0
      ? `${round2((Math.abs(c.diff) / c.ordenesUsd) * 100).toFixed(2)}%`
      : '0.00%';
    const status = Math.abs(c.diff) <= 1 ? '✅' : '⚠️';

    const row = ws.addRow([c.method, c.ordenesUsd, c.cajasUsd, c.diff, pct, status]);
    for (let col = 1; col <= 6; col++) {
      const cell = row.getCell(col);
      cell.fill = GREEN_FILL;
      cell.alignment = { horizontal: col <= 1 ? 'left' : 'right' };
    }
    // USD formats
    [2, 3, 4].forEach(col => {
      row.getCell(col).numFmt = USD_FORMAT;
    });
  }

  // Empty row
  ws.addRow([]);

  // Total row (yellow)
  const t = reconcileData.totals;
  const totalRow = ws.addRow([
    'TOTAL', t.ordenesUsd, t.cajasUsd, t.diff, t.pctDiff, t.status,
  ]);
  for (let col = 1; col <= 6; col++) {
    const cell = totalRow.getCell(col);
    cell.fill = YELLOW_FILL;
    cell.font = BOLD_FONT;
    cell.alignment = { horizontal: col <= 1 ? 'left' : 'right' };
  }
  [2, 3, 4].forEach(col => {
    totalRow.getCell(col).numFmt = USD_FORMAT;
  });

  // Empty row
  ws.addRow([]);

  // NOTAS section
  const notasRow = ws.addRow(['NOTAS:']);
  notasRow.font = BOLD_FONT;

  const notes = [
    '• Ordenes Activas = suma de pagos registrados en cada orden individual del POS',
    '• Cajas (Sistema) = totales reportados por cada operador al cierre de caja',
    '• Diferencia positiva = Ordenes reporta MÁS que Cajas',
    `• Tasa BCV usada: ${bcv}`,
  ];

  for (const note of notes) {
    const noteRow = ws.addRow([note]);
    const rowNum = noteRow.number;
    // Merge note across all columns (except last note which is short)
    if (note !== notes[notes.length - 1]) {
      ws.mergeCells(`A${rowNum}:F${rowNum}`);
    }
  }
}
