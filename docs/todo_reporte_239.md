# TODO: Reporte 239 — mcp-fullqueso-crm
# Date: 2026-02-27

## Phase 1: Project Setup
- [ ] Initialize npm project: `npm init -y`
- [ ] Install dependencies: `@modelcontextprotocol/sdk`, `node-fetch`, `exceljs`
- [ ] Create directory structure: lib/, tools/reporte-239/, config/, utils/, docs/
- [ ] Create .env with CRM_BASE_URL=https://crm-server-main.fullqueso.com/api/v2/report
- [ ] Create .env.example
- [ ] Create .gitignore (node_modules, .env, *.xlsx output)
- [ ] Create config/stores.js (store mappings, IGTF rules, method sort order)

## Phase 2: CRM Client
- [ ] Create lib/crm-client.js:
  - [ ] fetchOrders(date, shopCode) → GET /trans-by-day
  - [ ] fetchCounters(date, shopCode) → GET /counters-by-day
  - [ ] Error handling (non-200, empty data, network errors)
  - [ ] Timeout handling (30s max)

## Phase 3: Order Processor (tools/reporte-239/order-processor.js)
- [ ] deriveBCV(orders) — extract rate from punto/movil data
- [ ] decomposePayments(orders, bcv) — split each order into method lines
  - [ ] Handle punto (dynamic name from `punto` field, titlecase)
  - [ ] Handle pago movil
  - [ ] Handle cash USD (net = cash - cashVuelto)
  - [ ] Handle efectivo Bs
  - [ ] Handle zelle
  - [ ] Skip doc === "BC" orders
- [ ] aggregate(lines) — group by (doc, metodo), compute netosiniva/iva
- [ ] sortMethods(methods) — fixed order + dynamic puntos + fixed after
- [ ] calculateTotals(aggregated, storeCode, bcv) — totals + IGTF

## Phase 4: Counter Processor (tools/reporte-239/counter-processor.js)
- [ ] processCounters(counters) — extract structured data per operator
  - [ ] VES sistema/conteo/diff
  - [ ] USD sistema/conteo/diff
  - [ ] Punto sistemaUsd/conteoUsd/diffUsd + lote detail
  - [ ] Movil sistemaUsd/conteoUsd
  - [ ] Zelle sistema/conteo
  - [ ] Totals
- [ ] calculateGrandTotals(processedCounters) — sum across all operators

## Phase 5: Reconciler (tools/reporte-239/reconciler.js)
- [ ] reconcile(aggregated, counters, bcv) — cross-reference by payment type
  - [ ] Map OA punto methods → counters puntoSisUsd
  - [ ] Map OA movil → counters movilSisUsd
  - [ ] Map OA efectivo $ → counters usdSis
  - [ ] Map OA efectivo Bs → counters vesSisUsd
  - [ ] Map OA zelle → counters zelleSis
- [ ] Flag anomalies (diff > $1)
- [ ] Calculate totals and percentage diff

## Phase 6: Excel Writer (tools/reporte-239/excel-writer.js)
- [ ] Create workbook with ExcelJS
- [ ] Sheet 1 "Ordenes Activas":
  - [ ] Info header row (fecha, tienda, BCV)
  - [ ] Column headers with dark red styling
  - [ ] FAV section with methods + Total FAV (red)
  - [ ] NEN section with methods + Total NEN (red)
  - [ ] Grand total row
  - [ ] Verification section
  - [ ] Blue italic for dollar method VES values
  - [ ] Proper number formats (#,##0.00 for Bs, $#,##0.00 for USD)
  - [ ] Column widths and freeze panes
- [ ] Sheet 2 "Cajas":
  - [ ] Per-operator rows with all payment method detail
  - [ ] Lote detail where available
  - [ ] Grand total row
- [ ] Sheet 3 "Reconciliación":
  - [ ] Per payment type comparison
  - [ ] Diff and status columns
  - [ ] Total row
- [ ] Save to specified output directory
- [ ] Return file path

## Phase 7: MCP Server (server.js)
- [ ] Import MCP SDK
- [ ] Register 4 tools:
  - [ ] generate_239 (date, stores, format)
  - [ ] get_counters (date, stores)
  - [ ] reconcile_239 (date, stores)
  - [ ] full_report_239 (date, stores, output_dir)
- [ ] Tool handlers calling processor modules
- [ ] Global error handling
- [ ] Startup validation (CRM_BASE_URL)

## Phase 8: Tool Definitions (tools/reporte-239/index.js)
- [ ] Define all 4 tools with descriptions, parameters, enums
- [ ] Export definitions and handlers
- [ ] Wire up to server.js

## Phase 9: Testing
- [ ] Test with Feb 25, 2026 FQ01 — validate against known totals ($2,408.93)
- [ ] Test FQ28 same date — verify IGTF = 0
- [ ] Test FQ88 same date
- [ ] Test "all" stores
- [ ] Test empty date (no orders) — graceful error
- [ ] Test Excel output formatting visually
- [ ] Compare Excel output vs original Python script output
- [ ] Verify reconciliation diff matches previous manual run ($0.02)

## Phase 10: Integration & Release
- [ ] Add to Claude Desktop config (new entry, separate from BC MCP)
- [ ] Restart Claude Desktop and verify tools appear
- [ ] Test natural language queries: "genera el 239 de FQ01 de ayer"
- [ ] Git init + commit
- [ ] Create GitHub repo under @fullqueso
- [ ] Tag v1.0.0
- [ ] npm publish @fullqueso/mcp-crm
- [ ] Update README.md
- [ ] Create CHANGELOG.md entry

## Future Enhancements
- [ ] Date range support (generate for multiple days)
- [ ] Trend analysis (compare across days)
- [ ] Integration with BC MCP for full cash flow reconciliation
- [ ] Auto-detection of anomalies with alerts
