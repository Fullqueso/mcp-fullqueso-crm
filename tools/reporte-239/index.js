import { CRMClient } from '../../lib/crm-client.js';
import { deriveBCV, decomposePayments, aggregate, calculateTotals } from './order-processor.js';
import { processCounters, calculateGrandTotals } from './counter-processor.js';
import { reconcile } from './reconciler.js';
import { generateExcel } from './excel-writer.js';
import { resolveStores, getStoreName } from '../../config/stores.js';
import { round2 } from '../../utils/formatter.js';

// ─── Tool Definitions ───────────────────────────────────────────────────────

export const generate239Tool = {
  name: 'generate_239',
  description: 'Genera el Reporte 239 desde la API del CRM. Procesa ordenes activas, desglosa por FAV/NEN y método de pago, calcula IVA/IGTF, y genera Excel formateado listo para auditoría.',
  inputSchema: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'Fecha en formato YYYY-MM-DD' },
      stores: {
        type: 'array',
        items: { type: 'string', enum: ['FQ01', 'FQ28', 'FQ88', 'all'] },
        description: 'Códigos de tienda. Default: ["all"]',
        default: ['all'],
      },
      format: {
        type: 'string',
        enum: ['excel', 'summary'],
        description: 'Formato de salida: "excel" genera archivo, "summary" retorna JSON',
        default: 'summary',
      },
    },
    required: ['date'],
  },
};

export const getCountersTool = {
  name: 'get_counters',
  description: 'Obtiene el detalle de cierre de cajas del CRM para una fecha y tienda. Muestra por operador: sistema vs conteo, diferencias, y detalle de lotes POS.',
  inputSchema: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'Fecha en formato YYYY-MM-DD' },
      stores: {
        type: 'array',
        items: { type: 'string', enum: ['FQ01', 'FQ28', 'FQ88', 'all'] },
        description: 'Códigos de tienda. Default: ["all"]',
        default: ['all'],
      },
    },
    required: ['date'],
  },
};

export const reconcile239Tool = {
  name: 'reconcile_239',
  description: 'Cruza Ordenes Activas vs Cajas por forma de pago. Identifica diferencias entre lo que el sistema registró en transacciones vs lo que se cerró en caja.',
  inputSchema: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'Fecha en formato YYYY-MM-DD' },
      stores: {
        type: 'array',
        items: { type: 'string', enum: ['FQ01', 'FQ28', 'FQ88', 'all'] },
        description: 'Códigos de tienda. Default: ["all"]',
        default: ['all'],
      },
    },
    required: ['date'],
  },
};

export const fullReport239Tool = {
  name: 'full_report_239',
  description: 'Genera el reporte 239 completo: Excel con 3 hojas (Ordenes Activas, Cajas, Reconciliación) + resumen en texto. Es el reporte principal de auditoría diaria.',
  inputSchema: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'Fecha en formato YYYY-MM-DD' },
      stores: {
        type: 'array',
        items: { type: 'string', enum: ['FQ01', 'FQ28', 'FQ88', 'all'] },
        description: 'Códigos de tienda. Default: ["all"]',
        default: ['all'],
      },
      output_dir: {
        type: 'string',
        description: 'Directorio de salida para el Excel. Default: ~/Downloads',
      },
    },
    required: ['date'],
  },
};

export const allTools = [generate239Tool, getCountersTool, reconcile239Tool, fullReport239Tool];

// ─── Internal helpers ───────────────────────────────────────────────────────

async function processOrdersForStore(client, date, storeCode) {
  const data = await client.fetchOrders(date, storeCode);
  const orders = data.orders;
  const bcv = deriveBCV(orders);
  const lines = decomposePayments(orders, bcv);
  const aggregated = aggregate(lines);
  const reportData = calculateTotals(aggregated, storeCode, bcv);

  return {
    date,
    store: storeCode,
    storeName: getStoreName(storeCode),
    bcv,
    orderCount: data.count,
    ...reportData,
  };
}

async function processCountersForStore(client, date, storeCode) {
  const data = await client.fetchCounters(date, storeCode);
  const processed = processCounters(data);
  const grandTotal = calculateGrandTotals(processed.counters);
  return {
    date,
    store: storeCode,
    storeName: getStoreName(storeCode),
    rate: processed.rate,
    counters: processed.counters,
    grandTotal,
  };
}

// ─── Tool Handlers ──────────────────────────────────────────────────────────

export async function handleGenerate239(args) {
  const { date, stores, format = 'summary' } = args;
  const client = new CRMClient();
  const storeCodes = resolveStores(stores);
  const results = [];

  for (const sc of storeCodes) {
    const report = await processOrdersForStore(client, date, sc);
    results.push(report);
  }

  if (format === 'summary') {
    return results.length === 1 ? results[0] : results;
  }

  // Excel: generate one file per store
  const files = [];
  for (const report of results) {
    // Need counter data for excel but generate_239 alone doesn't require it
    // Just generate Sheet 1 data as excel
    const filepath = await generateExcel({
      reportData: report,
      counterData: { counters: [], rate: report.bcv },
      reconcileData: { comparison: [], totals: { ordenesUsd: 0, cajasUsd: 0, diff: 0, pctDiff: '0.00%', status: '✅' } },
      date,
      storeCode: report.store,
      storeName: report.storeName,
      bcv: report.bcv,
      orderCount: report.orderCount,
    });
    files.push(filepath);
  }

  return { files, summary: results };
}

export async function handleGetCounters(args) {
  const { date, stores } = args;
  const client = new CRMClient();
  const storeCodes = resolveStores(stores);
  const results = [];

  for (const sc of storeCodes) {
    const counterResult = await processCountersForStore(client, date, sc);
    results.push(counterResult);
  }

  return results.length === 1 ? results[0] : results;
}

export async function handleReconcile239(args) {
  const { date, stores } = args;
  const client = new CRMClient();
  const storeCodes = resolveStores(stores);
  const results = [];

  for (const sc of storeCodes) {
    // Parallel fetch: orders + counters at the same time
    const [report, counterResult] = await Promise.all([
      processOrdersForStore(client, date, sc),
      processCountersForStore(client, date, sc),
    ]);
    const reconcileResult = reconcile(report, counterResult);

    results.push({
      date,
      store: sc,
      storeName: getStoreName(sc),
      ...reconcileResult,
    });
  }

  return results.length === 1 ? results[0] : results;
}

export async function handleFullReport239(args) {
  const { date, stores, output_dir } = args;
  const client = new CRMClient();
  const storeCodes = resolveStores(stores);
  const results = [];

  for (const sc of storeCodes) {
    // Parallel fetch: orders + counters at the same time
    const [report, counterResult] = await Promise.all([
      processOrdersForStore(client, date, sc),
      processCountersForStore(client, date, sc),
    ]);
    const reconcileResult = reconcile(report, counterResult);

    const filepath = await generateExcel({
      reportData: report,
      counterData: counterResult,
      reconcileData: reconcileResult,
      date,
      storeCode: sc,
      storeName: report.storeName,
      bcv: report.bcv,
      orderCount: report.orderCount,
      outputDir: output_dir,
    });

    results.push({
      store: sc,
      storeName: report.storeName,
      file: filepath,
      summary: {
        date,
        bcv: report.bcv,
        orderCount: report.orderCount,
        totals: report.totals,
        verification: report.verification,
        reconciliation: reconcileResult.totals,
      },
    });
  }

  return results.length === 1 ? results[0] : results;
}
