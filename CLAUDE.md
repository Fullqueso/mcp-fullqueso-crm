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
- Dollar methods (Efectivo $, Zelle): netosiniva/iva calculated from Bs equivalent (same as other methods)

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
- Sections: FAV per-caja (CAJA1 → Total CAJA1 | CAJA2 → Total CAJA2) → Total FAV | NEN → Total NEN | TOTAL (FAV+NEN)
- Multi-caja: dynamic per-caja sections with subtotals (only cajas that exist are shown)
- Single-caja: flat section with CAJA1 label (no subtotal before Total FAV)
- Dollar methods styled blue italic; IGTF shows "-" when not applicable
- Red background (#FF0000) on total rows

### Sheet 2: Cajas
- 9 columns: Operador, Nombre, Terminal, Tipo, Sistema Bs, Sistema USD, Conteo Bs, Conteo USD, Diferencia USD
- Each operator expanded by payment type (Punto, Efectivo Bs, Efectivo $, Pago Movil, Zelle)
- Yellow total row, separate "Detalle de Lotes" section with blue headers

### Sheet 3: Reconciliación
- 7 columns: CODCAJA, Forma de Pago, Sistema Bs, Sistema USD, Conteo Bs, Conteo USD, Diferencia USD
- FAV per-caja sections with subtotals (same structure as Sheet 1), NEN consolidated
- Green data rows, red total rows, yellow grand total row
- NOTAS section: reconciliation rules, per-caja FAV adjustments (Punto shortfall → Efectivo Bs), NEN adjustments, rounding, verification checks

## Run
```bash
node server.js
```

## Testing with Latest Code

The MCP server caches Node.js modules at startup. After code changes, the MCP tools still run old code until the server restarts. To test with the latest code without restarting, use the standalone test script:

```bash
node /tmp/test-reconcile-caja.mjs
```

This generates Excel reports directly to `~/Downloads` for FQ88 and FQ01 (2026-02-25), bypassing the MCP server cache. Update the `DATE` and store codes in the script as needed.
