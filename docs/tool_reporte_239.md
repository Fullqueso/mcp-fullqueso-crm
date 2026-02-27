# Tool Spec: Reporte 239 (CRM API)
# MCP: mcp-fullqueso-crm
# Date: 2026-02-27
# Status: Ready for implementation

## Overview

MCP server that connects to the Full Queso CRM/POS API (`crm-server-main.fullqueso.com`) to generate the daily "Reporte 239" — a sales reconciliation report by document type (FAV/NEN) and payment method, with full VES/USD reconciliation, and cross-reference between Ordenes Activas (transactions) and Cajas (counter closings).

**Why a separate MCP:** This is NOT Business Central — it's the CRM/POS server. Different API, no OAuth, different domain. Follows the principle: one MCP per data source.

**Value:** Replaces the manual process of downloading Excel from the CRM portal, running the Python script, and manually comparing. Now it's one Claude query → formatted Excel report.

## API Endpoints

### Base URL
```
https://crm-server-main.fullqueso.com/api/v2/report
```

**Auth:** None required (public API, no tokens needed).

### Endpoint 1: Ordenes Activas (trans-by-day)
```
GET /trans-by-day?date=YYYY-MM-DD&shopCode=FQ01
```

**Response structure:**
```json
{
  "success": true,
  "date": "2026-02-25",
  "shopCode": "FQ01",
  "count": 291,
  "orders": [
    {
      "orden": "260225-203607",
      "shopName": "Sambil Caracas",
      "mode": "tienda",
      "doc": "NEN",            // FAV, NEN, or BC (exclude BC)
      "bcv": "",
      "total": 14.5,
      "pagado": 14.5,
      "pagoPuntoBs": 5960.8,
      "pagoPuntoUsd": 14.5,
      "punto": "PUNTO 11",     // Terminal name (dynamic per store)
      "pagoMovilBs": 0,
      "pagoMovilUsd": 0,
      "cash": 0,               // Cash USD gross
      "cashVuelto": 0,         // Cash USD change given
      "pagoEfectivoBs": 0,     // Cash VES
      "pagoEfectivoBsVuelto": 0,
      "zelle": 0
    }
  ]
}
```

### Endpoint 2: Cajas / Counters (counters-by-day)
```
GET /counters-by-day?date=YYYY-MM-DD&shopCode=FQ01
```

**Response structure:**
```json
{
  "success": true,
  "date": "2026-02-25",
  "shopCode": "FQ01",
  "count": 4,
  "counters": [
    {
      "operatorCode": "UBII-12",
      "operatorName": "TAHINA",
      "efectivoBs": 0,           // Cash VES from caja base
      "efectivoUsd": 0,          // Cash USD from caja base
      "punto": "PUNTO 12",       // Terminal assigned
      "rate": 411.09,            // BCV rate
      "caja": "CAJA1",
      // --- VES cash from sales ---
      "vesSis": 0,               // System VES
      "vesSisUsd": 0,            // System VES converted to USD
      "vesConteo": 0,            // Counted VES
      "vesConteoUsd": 0,
      "vesDif": 0,               // Difference
      // --- USD cash from sales ---
      "usdSis": 0,               // System USD
      "usdConteo": 0,            // Counted USD
      "usdDif": 0,
      // --- POS/Punto ---
      "puntosDetectados": ["PUNTO 12"],
      "puntosSistema": {"PUNTO 12": {"bs": 161169.97, "usd": 392.07}},
      "puntoSis": 161169.97,     // Total punto sistema Bs
      "puntoSisUsd": 392.07,     // Total punto sistema USD
      "puntosConteo": {"PUNTO 12": {"lotes": [{"lote": "35", "monto": 21526.47}, ...]}},
      "puntoConteoBs": 161169.97,
      "puntoConteoUsd": 392.06,
      "puntoDif": 0,             // Diff Bs
      "puntoDifUsd": 0.01,       // Diff USD
      // --- Pago Móvil ---
      "movilSis": 0,             // Sistema Bs
      "movilSisUsd": 0,
      "movilConteoBs": 0,
      "movilConteoUsd": 0,
      "movilDif": 0,
      "movilDifUsd": 0,
      // --- Zelle ---
      "zelleSis": 0,
      "zelleConteo": 0,
      "zelleDif": 0,
      // --- Totals ---
      "totalSisUsd": 392.07,
      "totalConteoUsd": 392.06,
      "totalDif": -0.01,
      "totalCierre": 392.07,
      "porcentajeDiferencia": 0,
      "cerradoPor": "ADMIN"
    }
  ]
}
```

**Key counter types seen:**
- Operator counters (TAHINA/M03, TATIANA/M01) — regular POS operators
- Delivery counter (FQ01-DELIVERY) — delivery/carro orders
- Each counter has its own punto terminal assignment

## Tools

### Tool 1: `generate_239`
**Description:** Genera el Reporte 239 desde la API del CRM. Procesa ordenes activas, desglosa por FAV/NEN y método de pago, calcula IVA/IGTF, y genera Excel formateado listo para auditoría.

**Parameters:**
| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| date | string | yes | — | Date in YYYY-MM-DD format |
| stores | string[] | no | ["all"] | Store codes: FQ01, FQ28, FQ88, or ["all"] |
| format | enum | no | "summary" | Output: "excel" (file) or "summary" (JSON) |

**Processing Logic:**

1. Fetch `trans-by-day` for each store
2. Derive BCV: `pagoPuntoBs / pagoPuntoUsd` from first order with both > 0
3. Decompose each order into payment method lines:
   - `pagoPuntoBs/Usd > 0` → method = `punto` field value (titlecased)
   - `pagoMovilBs/Usd > 0` → method = "Pago Movil Tienda Venezuela 5187"
   - `cash - cashVuelto > 0` → method = "Efectivo $ Tienda" (isDollar=true)
   - `pagoEfectivoBs > 0` → method = "Efectivo Bs Tienda"
   - `zelle > 0` → method = "Zelle" (isDollar=true)
   - Skip orders where `doc === "BC"`
4. Aggregate by (doc, metodo): sum bs, sum usd
5. Calculate derived columns:
   - `netosiniva = bs / 1.16` (0 for dollar methods)
   - `iva = bs - netosiniva` (0 for dollar methods)
   - `igtf = usd * 0.03 * bcv` (only FAV + dollar methods + non-exempt stores)
6. Sort methods: fixed order → dynamic puntos alphabetically → fixed after
7. Generate Excel with formatting

**Method sort order:**
```
1. Efectivo $ Tienda
2. Efectivo Bs Tienda
3. Pago Movil Tienda Venezuela 5187
4. [Dynamic punto names, alphabetically]
5. Zelle
6. Sin nombre
```

**IGTF exemptions:** FQ28 is NOT an IGTF agent → IGTF = 0 for all methods.

**Dollar methods** (Efectivo $ Tienda, Zelle): NETOSINIVA = 0, IVA = 0. VES amounts are reference only (USD × BCV). Format in blue italic in Excel.

**Response Schema (format=summary):**
```json
{
  "date": "2026-02-25",
  "store": "FQ01",
  "storeName": "FQ01 - Sambil Chacao",
  "bcv": 411.09,
  "orderCount": 291,
  "fav": {
    "bs": 525849.12,
    "usd": 1279.20,
    "netosiniva": 453318.21,
    "iva": 72530.91,
    "igtf": 1020.45,
    "methods": [
      {"metodo": "Punto 11", "bs": 200000, "usd": 486.50, "netosiniva": 172413.79, "iva": 27586.21, "igtf": 0}
    ]
  },
  "nen": { /* same structure, igtf always 0 */ },
  "totals": {
    "bs": 990123.45,
    "usd": 2408.93,
    "netosiniva": 853554.70,
    "iva": 136568.75,
    "igtf": 1020.45
  },
  "verification": {
    "netoviaBcv": 2408.82,
    "netocivaUsd": 2408.93,
    "diff": 0.11
  }
}
```

**Response (format=excel):**
Returns path to generated Excel file, plus the summary JSON above.

### Tool 2: `get_counters`
**Description:** Obtiene el detalle de cierre de cajas del CRM para una fecha y tienda. Muestra por operador: sistema vs conteo, diferencias, y detalle de lotes POS.

**Parameters:**
| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| date | string | yes | — | Date in YYYY-MM-DD format |
| stores | string[] | no | ["all"] | Store codes |

**Processing Logic:**
1. Fetch `counters-by-day` for each store
2. For each counter, extract:
   - Operator name, code, terminal
   - VES: sistema vs conteo → diff
   - USD: sistema vs conteo → diff
   - Punto: sistema vs conteo (with lote detail from puntosConteo)
   - Móvil: sistema vs conteo
   - Zelle: sistema vs conteo
   - Totals: sistema vs conteo, percentage diff
3. Return structured data

**Response Schema:**
```json
{
  "date": "2026-02-25",
  "store": "FQ01",
  "rate": 411.09,
  "counters": [
    {
      "operator": "TAHINA",
      "operatorCode": "UBII-12",
      "punto": "PUNTO 12",
      "caja": "CAJA1",
      "efectivoBs": 0,
      "efectivoUsd": 0,
      "ves": {"sistema": 0, "conteo": 0, "diff": 0},
      "usd": {"sistema": 0, "conteo": 0, "diff": 0},
      "punto_detail": {"sistemaUsd": 392.07, "conteoUsd": 392.06, "diffUsd": 0.01},
      "movil": {"sistemaUsd": 0, "conteoUsd": 0, "diffUsd": 0},
      "zelle": {"sistema": 0, "conteo": 0, "diff": 0},
      "totalUsd": {"sistema": 392.07, "conteo": 392.06, "diff": -0.01},
      "lotes": [{"terminal": "PUNTO 12", "lote": "35", "monto": 21526.47}]
    }
  ],
  "grandTotal": {"sistemaUsd": 2408.91, "conteoUsd": 2408.93, "diffUsd": 0.02}
}
```

### Tool 3: `reconcile_239`
**Description:** Cruza Ordenes Activas vs Cajas por forma de pago. Identifica diferencias entre lo que el sistema registró en transacciones vs lo que se cerró en caja.

**Parameters:**
| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| date | string | yes | — | Date in YYYY-MM-DD format |
| stores | string[] | no | ["all"] | Store codes |

**Processing Logic:**
1. Call generate_239 internally (get ordenes activas aggregated)
2. Call get_counters internally (get counter data)
3. Cross-reference by payment type:

| Payment Type | Ordenes Activas Source | Counters Source |
|---|---|---|
| Punto (POS) | Sum all punto methods USD | Sum `puntoSisUsd` across counters |
| Pago Móvil | Sum movil methods USD | Sum `movilSisUsd` across counters |
| Efectivo $ | "Efectivo $ Tienda" USD | Sum `usdSis` across counters |
| Efectivo Bs | "Efectivo Bs Tienda" USD | Sum `vesSisUsd` across counters |
| Zelle | "Zelle" USD | Sum `zelleSis` across counters |

4. Calculate diffs and flag anomalies (>$1 diff)

**Response Schema:**
```json
{
  "date": "2026-02-25",
  "store": "FQ01",
  "comparison": [
    {"method": "Punto (POS)", "ordenesUsd": 1622.24, "cajasUsd": 1622.24, "diff": 0, "status": "✅"},
    {"method": "Pago Móvil", "ordenesUsd": 685.75, "cajasUsd": 685.75, "diff": 0, "status": "✅"},
    {"method": "Efectivo $", "ordenesUsd": 82.52, "cajasUsd": 86.02, "diff": -3.50, "status": "⚠️"},
    {"method": "Efectivo Bs", "ordenesUsd": 14.90, "cajasUsd": 14.90, "diff": 0, "status": "✅"},
    {"method": "Zelle", "ordenesUsd": 0, "cajasUsd": 0, "diff": 0, "status": "✅"}
  ],
  "totals": {"ordenesUsd": 2408.93, "cajasUsd": 2408.91, "diff": 0.02, "pctDiff": "0.00%", "status": "✅"}
}
```

### Tool 4: `full_report_239`
**Description:** Genera el reporte 239 completo: Excel con 3 hojas (Ordenes Activas, Cajas, Reconciliación) + resumen en texto. Es el reporte principal de auditoría diaria.

**Parameters:**
| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| date | string | yes | — | Date YYYY-MM-DD |
| stores | string[] | no | ["all"] | Store codes |
| output_dir | string | no | ~/Downloads | Where to save Excel |

**Processing Logic:**
1. Parallel fetch: orders + counters via `Promise.all`
2. Process orders → reconcile → generate Excel workbook with 3 sheets

**Sheet 1 "Ordenes Activas"** (8 columns):
- Row 1: Fecha (merged A1:B1), date, Tienda, store, BCV, rate, Ordenes: N
- Row 2: Headers — CODCAJA, METODO_PAGO, Suma NETOCIVA Bs, Suma NETOCIVAUSD, Qty, NETOSINIVA, IVA, IGTF (3%)
- FAV section: CODCAJA=CAJA1, each method row, "Total FAV" (red #FF0000)
- NEN section: CODCAJA=NEN, each method row, "Total NEN" (red)
- Blank row + "TOTAL (FAV+NEN)" (red)
- Dollar methods: blue italic entire row, IGTF shows "-" when not applicable
- Freeze: ySplit=2

**Sheet 2 "Cajas"** (9 columns):
- Row 1: Title merged A1:H1 "Cajas - {store} - {date}"
- Row 3: Headers — Operador, Nombre, Terminal, Tipo, Sistema Bs, Sistema USD, Conteo Bs, Conteo USD, Diferencia USD
- Each operator expanded into rows per payment type (Punto, Efectivo Bs, Efectivo $, Pago Movil, Zelle)
- "TOTAL CAJAS" row with yellow background (#FFF2CC)
- Separate "DETALLE DE LOTES" section with blue headers (#4472C4): Operador, Terminal, Lote, Monto Bs, Monto USD
- Diferencia USD = conteo - sistema
- Freeze: ySplit=3

**Sheet 3 "Reconciliación"** (6 columns):
- Row 1: Title merged A1:F1 "RECONCILIACIÓN ORDENES ACTIVAS vs CAJAS — {store} — {date}" (bold red text)
- Row 3: Headers — Forma de Pago, Ordenes Activas USD, Cajas (Sistema) USD, Diferencia USD, Diferencia %, Status
- Data rows with green background (#E2EFDA)
- "TOTAL" row with yellow background (#FFF2CC)
- NOTAS section with merged cells explaining OA, Cajas, diferencia, and BCV rate used

**Common formatting:**
- Column headers: white bold on dark red (#CC0000), centered
- VES format: #,##0.00 | USD format: $#,##0.00
- Column widths: Sheet1=[12,35,18,18,8,18,16,14] | Sheet2=[18,14,12,16,16,16,16,16,16] | Sheet3=[22,22,22,22,14,12]

**Output:** Excel file path + summary JSON.

## Project Structure

```
mcp-fullqueso-crm/
├── package.json
├── server.js                    # MCP server entry point
├── .env                         # CRM_BASE_URL (no auth needed)
├── .env.example
├── .gitignore
├── README.md
├── CLAUDE.md
├── CHANGELOG.md
├── docs/
│   ├── tool_reporte_239.md      # ← This file
│   └── todo_reporte_239.md      # Implementation checklist
├── lib/
│   └── crm-client.js            # HTTP client for CRM API (node-fetch)
├── tools/
│   └── reporte-239/
│       ├── index.js             # Tool definitions + handlers
│       ├── order-processor.js   # Decompose + aggregate ordenes activas
│       ├── counter-processor.js # Process counter data
│       ├── reconciler.js        # Cross-reference OA vs Cajas
│       └── excel-writer.js      # Generate formatted Excel (ExcelJS)
├── config/
│   └── stores.js               # Store mappings + IGTF rules
└── utils/
    └── formatter.js            # Number formatting helpers
```

## Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "latest",
    "node-fetch": "^3.3.0",
    "exceljs": "^4.4.0"
  }
}
```

## Key Business Rules

1. **BCV derivation:** `pagoPuntoBs / pagoPuntoUsd` from first order with both > 0. Fallback: `pagoMovilBs / pagoMovilUsd`.
2. **Cash USD = net:** `cash - cashVuelto` (change is deducted).
3. **IVA = 16%:** `netosiniva = netociva / 1.16`, `iva = netociva - netosiniva`. Dollar methods: both = 0.
4. **IGTF = 3%:** `usd * 0.03 * bcv`. Only FAV section, only dollar methods, only non-exempt stores.
5. **FQ28 is IGTF exempt.**
6. **Exclude `doc === "BC"` orders.**
7. **Dollar methods:** Efectivo $ Tienda, Zelle. Their VES is reference (= USD × BCV).
8. **Punto names** come from data (`punto` field), titlecased. Dynamic per store.

## Edge Cases

- No orders for date → return error with message
- No punto/movil data to derive BCV → error
- Counter with empty `punto` field (delivery) → skip punto reconciliation
- All counters have 0 for a method → show 0 in reconciliation
- Multiple counters per operator (morning/evening shift) → sum all

## Validation Plan

- **Feb 25, 2026 FQ01:** Compare output vs the Excel we generated manually (2408.93 total USD, diff $0.02)
- **Test all 3 stores** same date
- **Test IGTF:** FQ01 should have IGTF, FQ28 should not
- **Test empty date:** Expect graceful error
