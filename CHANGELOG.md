# Changelog

## [1.0.0] — 2026-02-27

### Added
- MCP server with 4 tools for Reporte 239 daily sales reconciliation
- `generate_239` — Process orders by FAV/NEN, decompose by payment method, calculate IVA/IGTF
- `get_counters` — Fetch and structure counter/caja closing data per operator
- `reconcile_239` — Cross-reference Ordenes Activas vs Cajas by payment type
- `full_report_239` — Complete 3-sheet Excel workbook + JSON summary
- CRM API client (`lib/crm-client.js`) with timeout handling (30s)
- BCV rate derivation from punto transaction data
- IGTF exemption logic (FQ28 exempt)
- Store configuration for FQ01, FQ28, FQ88

### Excel Format (3 sheets)
- **Ordenes Activas** — 8 columns: CODCAJA, METODO_PAGO, NETOCIVA Bs, NETOCIVAUSD, Qty, NETOSINIVA, IVA, IGTF. Dollar methods in blue italic. Section totals (FAV/NEN) + grand total with red background.
- **Cajas** — Operators expanded by payment type (Punto, Efectivo Bs, Efectivo $, Pago Movil, Zelle). Yellow total row. Separate "Detalle de Lotes" section with blue headers.
- **Reconciliación** — OA vs Cajas comparison with green data rows, yellow total, Diferencia %, status indicators, and NOTAS section with BCV rate.

### Performance
- Parallel API calls (orders + counters fetched simultaneously via Promise.all)
- Compact JSON responses (no pretty-print overhead)
