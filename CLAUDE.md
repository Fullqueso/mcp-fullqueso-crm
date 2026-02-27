# mcp-fullqueso-crm

MCP server for Full Queso CRM/POS API — generates Reporte 239 (daily sales reconciliation).

## Disambiguation: CRM vs BC Gastos

> **Este MCP (`fullqueso-crm`) es el correcto para el Reporte 239.**
>
> El MCP `fullqueso-bc-gastos` tiene una herramienta `reconcile_pos_sales` que cruza depósitos bancarios vs lotes POS en Business Central. Son complementarios, NO son lo mismo:
>
> | Aspecto | `fullqueso-crm` (este) | `fullqueso-bc-gastos` |
> |---------|----------------------|----------------------|
> | **Reporte** | Reporte 239 diario | Reconciliación bancaria |
> | **Fuente** | CRM/POS API (ordenes + cajas) | Business Central (contabilidad) |
> | **Salida** | Excel 3 hojas + resumen | JSON texto |
> | **Uso** | Auditoría diaria de ventas | Cuadre de depósitos bancarios |
>
> **Regla simple:** Si el usuario pide "reporte 239", "ordenes activas", "cajas", o "reconciliación de ventas" → usar este MCP (`fullqueso-crm`).

## How to Use This MCP

When the user asks for a Reporte 239, use the tools in this order depending on what they need:

- **Quick summary** → `generate_239` with format="summary"
- **Excel de ordenes only** → `generate_239` with format="excel"
- **Cierre de cajas** → `get_counters`
- **Solo reconciliación** → `reconcile_239`
- **Reporte completo** (recommended default) → `full_report_239`

Parameters:
- `date`: Always YYYY-MM-DD format
- `stores`: Array of store codes. Use `["FQ01"]`, `["FQ28"]`, `["FQ88"]`, or omit for all stores
- `output_dir`: Optional, defaults to ~/Downloads

Example user requests and which tool to call:
- "Genera el 239 de FQ01 de ayer" → `full_report_239` {date: "YYYY-MM-DD", stores: ["FQ01"]}
- "Dame el resumen de ventas de hoy" → `generate_239` {date: "YYYY-MM-DD", format: "summary"}
- "Cuánto cerró cada caja ayer?" → `get_counters` {date: "YYYY-MM-DD"}
- "Hay diferencias entre ordenes y cajas?" → `reconcile_239` {date: "YYYY-MM-DD"}

## Architecture
- **server.js** — MCP entry point (stdio transport)
- **lib/crm-client.js** — HTTP client for CRM API (no auth needed)
- **tools/reporte-239/** — All report logic:
  - `index.js` — Tool definitions + handlers (parallel API calls)
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

## Excel Output Format (full_report_239)

### Sheet 1: Ordenes Activas
- 8 columns: CODCAJA, METODO_PAGO, Suma NETOCIVA Bs, Suma NETOCIVAUSD, Qty, NETOSINIVA, IVA, IGTF (3%)
- Sections: FAV (CAJA1) → Total FAV | NEN → Total NEN | TOTAL (FAV+NEN)
- Dollar methods styled blue italic; IGTF shows "-" when not applicable
- Red background (#FF0000) on total rows

### Sheet 2: Cajas
- 9 columns: Operador, Nombre, Terminal, Tipo, Sistema Bs, Sistema USD, Conteo Bs, Conteo USD, Diferencia USD
- Each operator expanded by payment type (Punto, Efectivo Bs, Efectivo $, Pago Movil, Zelle)
- Yellow total row, separate "Detalle de Lotes" section with blue headers

### Sheet 3: Reconciliación
- 6 columns: Forma de Pago, Ordenes Activas USD, Cajas (Sistema) USD, Diferencia USD, Diferencia %, Status
- Green data rows, yellow total row, NOTAS section at bottom

## Run
```bash
node server.js
```
