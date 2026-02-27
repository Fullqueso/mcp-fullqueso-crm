export const STORES = {
  FQ01: { code: 'FQ01', name: 'FQ01 - Sambil Chacao', igtfAgent: true },
  FQ28: { code: 'FQ28', name: 'FQ28 - Parque Cerro Verde', igtfAgent: false },
  FQ88: { code: 'FQ88', name: 'FQ88 - Delivery / Virtual', igtfAgent: true },
};

export const ALL_STORE_CODES = Object.keys(STORES);

export function resolveStores(stores) {
  if (!stores || stores.length === 0 || (stores.length === 1 && stores[0] === 'all')) {
    return ALL_STORE_CODES;
  }
  return stores.map(s => s.toUpperCase());
}

export function isIGTFAgent(storeCode) {
  const store = STORES[storeCode];
  return store ? store.igtfAgent : true;
}

export function getStoreName(storeCode) {
  const store = STORES[storeCode];
  return store ? store.name : storeCode;
}

// Fixed method sort order
export const METHOD_SORT_ORDER = [
  'Efectivo $ Tienda',
  'Efectivo Bs Tienda',
  'Pago Movil Tienda Venezuela 5187',
];

export const METHOD_SORT_AFTER = [
  'Zelle',
  'Sin nombre',
];

export const DOLLAR_METHODS = ['Efectivo $ Tienda', 'Zelle'];

export function isDollarMethod(method) {
  return DOLLAR_METHODS.includes(method);
}
