import ExcelJS from 'exceljs';
import { join } from 'path';
import { homedir } from 'os';
import { round2 } from '../../utils/formatter.js';

// Styles
const DARK_RED = { argb: 'FFCC0000' };
const RED = { argb: 'FFFF0000' };
const WHITE = { argb: 'FFFFFFFF' };
const BLUE = { argb: 'FF0000CC' };

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: DARK_RED };
const TOTAL_FILL = { type: 'pattern', pattern: 'solid', fgColor: RED };
const HEADER_FONT = { bold: true, color: WHITE, size: 10 };
const TOTAL_FONT = { bold: true, color: WHITE, size: 10 };
const BLUE_ITALIC_FONT = { italic: true, color: BLUE, size: 10 };

const BS_FORMAT = '#,##0.00';
const USD_FORMAT = '$#,##0.00';

const COL_WIDTHS = [12, 38, 18, 14, 18, 16, 20, 14, 14, 12, 16];

/**
 * Generate full Excel report with 3 sheets.
 */
export async function generateExcel({ reportData, counterData, reconcileData, date, storeCode, storeName, bcv, orderCount, outputDir }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MCP FullQueso CRM';
  wb.created = new Date();

  writeOrdenesSheet(wb, { reportData, date, storeCode, storeName, bcv, orderCount });
  writeCajasSheet(wb, { counterData, date, storeName });
  writeReconciliacionSheet(wb, { reconcileData, date, storeName });

  const dir = outputDir || join(homedir(), 'Downloads');
  const filename = `Reporte239_${storeCode}_${date}.xlsx`;
  const filepath = join(dir, filename);

  await wb.xlsx.writeFile(filepath);
  return filepath;
}

// ─── Sheet 1: Ordenes Activas ───────────────────────────────────────────────

function writeOrdenesSheet(wb, { reportData, date, storeCode, storeName, bcv, orderCount }) {
  const ws = wb.addWorksheet('Ordenes Activas');

  // Column widths
  COL_WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  // Row 1: Info header
  const infoRow = ws.addRow(['Fecha', date, 'Tienda', storeName, 'Tasa BCV', bcv, 'Órdenes', orderCount]);
  infoRow.font = { bold: true, size: 10 };

  // Row 2: Column headers
  const headers = ['CODCAJA', 'METODO', 'NETOCIVA', 'NETOCIVAUSD', 'NETOSINIVA', 'IVA', 'IGTF', 'BS_REF', 'USD_REF', 'ISDOLLAR', 'VERIFICACION'];
  const headerRow = ws.addRow(headers);
  headerRow.eachCell(cell => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { horizontal: 'center', wrapText: true };
  });

  // Freeze panes at row 3
  ws.views = [{ state: 'frozen', ySplit: 2 }];

  const { fav, nen, totals, verification } = reportData;

  // FAV section
  writeSectionRows(ws, 'CAJA1', fav, bcv);
  writeTotalRow(ws, 'Total CAJA1', fav);
  writeTotalRow(ws, 'TOTAL FAV', fav, true);

  // NEN section
  writeSectionRows(ws, 'NEN', nen, bcv);
  writeTotalRow(ws, 'TOTAL NEN', nen, true);

  // Grand total
  const grandRow = ws.addRow([
    '', 'GRAN TOTAL',
    totals.bs, totals.usd, totals.netosiniva, totals.iva, totals.igtf,
    '', '', '', '',
  ]);
  styleTotal(grandRow);

  // Empty row
  ws.addRow([]);

  // Verification
  const vRow1 = ws.addRow(['', 'VERIFICACIÓN', '', '', '', '', '', '', '', '', '']);
  vRow1.font = { bold: true, size: 10 };
  ws.addRow(['', 'NETOCIVA / BCV', verification.netoviaBcv]);
  ws.addRow(['', 'NETOCIVAUSD', verification.netocivaUsd]);
  ws.addRow(['', 'Diferencia', verification.diff]);

  // Apply number formats
  applyNumberFormats(ws);
}

function writeSectionRows(ws, codcaja, section, bcv) {
  for (const m of section.methods) {
    const row = ws.addRow([
      codcaja,
      m.metodo,
      m.bs,
      m.usd,
      m.netosiniva,
      m.iva,
      m.igtf,
      m.isDollar ? m.bs : '',
      m.isDollar ? m.usd : '',
      m.isDollar ? 'SI' : '',
      '',
    ]);

    // Blue italic for dollar method VES values
    if (m.isDollar) {
      [3, 5, 6].forEach(col => {
        row.getCell(col).font = BLUE_ITALIC_FONT;
      });
    }
  }
}

function writeTotalRow(ws, label, section, isMainTotal = false) {
  const row = ws.addRow([
    '', label,
    section.bs, section.usd, section.netosiniva, section.iva, section.igtf,
    '', '', '', '',
  ]);
  if (isMainTotal) {
    styleTotal(row);
  } else {
    row.font = { bold: true, size: 10 };
  }
}

function styleTotal(row) {
  row.eachCell(cell => {
    cell.fill = TOTAL_FILL;
    cell.font = TOTAL_FONT;
  });
}

function applyNumberFormats(ws) {
  ws.eachRow(row => {
    // Column 3 (NETOCIVA) = Bs, Col 5 (NETOSINIVA) = Bs, Col 6 (IVA) = Bs, Col 7 (IGTF) = Bs, Col 8 (BS_REF) = Bs
    [3, 5, 6, 7, 8].forEach(col => {
      const cell = row.getCell(col);
      if (typeof cell.value === 'number') {
        cell.numFmt = BS_FORMAT;
      }
    });
    // Column 4 (NETOCIVAUSD) = USD, Col 9 (USD_REF) = USD
    [4, 9].forEach(col => {
      const cell = row.getCell(col);
      if (typeof cell.value === 'number') {
        cell.numFmt = USD_FORMAT;
      }
    });
  });
}

// ─── Sheet 2: Cajas ─────────────────────────────────────────────────────────

function writeCajasSheet(wb, { counterData, date, storeName }) {
  const ws = wb.addWorksheet('Cajas');

  // Column widths
  const cajaCols = [16, 16, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14];
  cajaCols.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  // Info row
  const infoRow = ws.addRow(['Fecha', date, 'Tienda', storeName, 'Tasa', counterData.rate]);
  infoRow.font = { bold: true, size: 10 };

  // Headers
  const headers = [
    'Operador', 'Terminal', 'Caja',
    'VES Sis', 'VES Conteo', 'VES Dif',
    'USD Sis', 'USD Conteo', 'USD Dif',
    'Punto Sis$', 'Punto Cont$', 'Punto Dif$',
    'Movil Sis$', 'Zelle Sis',
    'Total Sis$', 'Total Cont$',
  ];
  const headerRow = ws.addRow(headers);
  headerRow.eachCell(cell => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { horizontal: 'center', wrapText: true };
  });

  ws.views = [{ state: 'frozen', ySplit: 2 }];

  // Data rows
  for (const c of counterData.counters) {
    const row = ws.addRow([
      c.operator,
      c.punto,
      c.caja,
      c.ves.sistema,
      c.ves.conteo,
      c.ves.diff,
      c.usd.sistema,
      c.usd.conteo,
      c.usd.diff,
      c.punto_detail.sistemaUsd,
      c.punto_detail.conteoUsd,
      c.punto_detail.diffUsd,
      c.movil.sistemaUsd,
      c.zelle.sistema,
      c.totalUsd.sistema,
      c.totalUsd.conteo,
    ]);

    // Lote detail as sub-rows
    for (const l of c.lotes) {
      ws.addRow(['', `  Lote ${l.lote}`, l.terminal, '', '', '', '', '', '', l.monto]);
    }
  }

  // Grand total row
  const gt = counterData.grandTotal;
  if (gt) {
    const row = ws.addRow([
      'GRAN TOTAL', '', '',
      gt.detail.vesSistema, gt.detail.vesConteo, '',
      gt.detail.usdSistema, gt.detail.usdConteo, '',
      gt.detail.puntoSistemaUsd, gt.detail.puntoConteoUsd, '',
      gt.detail.movilSistemaUsd, gt.detail.zelleSistema,
      gt.sistemaUsd, gt.conteoUsd,
    ]);
    styleTotal(row);
  }

  // Number formats
  ws.eachRow(row => {
    for (let c = 4; c <= 16; c++) {
      const cell = row.getCell(c);
      if (typeof cell.value === 'number') {
        cell.numFmt = USD_FORMAT;
      }
    }
  });
}

// ─── Sheet 3: Reconciliación ────────────────────────────────────────────────

function writeReconciliacionSheet(wb, { reconcileData, date, storeName }) {
  const ws = wb.addWorksheet('Reconciliación');

  const recCols = [20, 18, 18, 14, 10];
  recCols.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  const infoRow = ws.addRow(['Fecha', date, 'Tienda', storeName]);
  infoRow.font = { bold: true, size: 10 };

  const headers = ['Forma de Pago', 'Ordenes USD', 'Cajas USD', 'Diferencia', 'Status'];
  const headerRow = ws.addRow(headers);
  headerRow.eachCell(cell => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { horizontal: 'center', wrapText: true };
  });

  ws.views = [{ state: 'frozen', ySplit: 2 }];

  for (const c of reconcileData.comparison) {
    ws.addRow([c.method, c.ordenesUsd, c.cajasUsd, c.diff, c.status]);
  }

  // Total row
  const t = reconcileData.totals;
  const totalRow = ws.addRow(['TOTAL', t.ordenesUsd, t.cajasUsd, t.diff, `${t.pctDiff} ${t.status}`]);
  styleTotal(totalRow);

  // Number formats
  ws.eachRow(row => {
    [2, 3, 4].forEach(col => {
      const cell = row.getCell(col);
      if (typeof cell.value === 'number') {
        cell.numFmt = USD_FORMAT;
      }
    });
  });
}
