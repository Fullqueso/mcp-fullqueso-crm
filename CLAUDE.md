# mcp-fullqueso-crm

MCP server for Full Queso CRM/POS API — generates Reporte 239 (daily sales reconciliation).

## Architecture
- **server.js** — MCP entry point (stdio transport)
- **lib/crm-client.js** — HTTP client for CRM API (no auth needed)
- **tools/reporte-239/** — All report logic:
  - `index.js` — Tool definitions + handlers
  - `order-processor.js` — BCV derivation, payment decomposition, aggregation, IVA/IGTF
  - `counter-processor.js` — Counter/caja closing data processing
  - `reconciler.js` — Cross-reference orders vs counters
  - `excel-writer.js` — ExcelJS formatted output (3 sheets)
- **config/stores.js** — Store mappings, IGTF rules, method sort order
- **utils/formatter.js** — Number rounding, titleCase

## Key Business Rules
- BCV derived from punto data: `pagoPuntoBs / pagoPuntoUsd`
- Cash USD net = `cash - cashVuelto`
- IVA = 16%, IGTF = 3% (FAV + dollar methods only, FQ28 exempt)
- Exclude `doc === "BC"` orders
- Dollar methods (Efectivo $, Zelle): netosiniva=0, iva=0

## API
- Base: `https://crm-server-main.fullqueso.com/api/v2/report`
- No auth required
- Endpoints: `/trans-by-day`, `/counters-by-day`

## Tools
1. `generate_239` — Orders report (summary or Excel)
2. `get_counters` — Counter closings detail
3. `reconcile_239` — Cross-reference OA vs Cajas
4. `full_report_239` — Complete 3-sheet Excel + summary

## Run
```bash
node server.js
```
