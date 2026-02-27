import fetch from 'node-fetch';

const TIMEOUT_MS = 30_000;

export class CRMClient {
  constructor(baseUrl) {
    this.baseUrl = (baseUrl || process.env.CRM_BASE_URL).replace(/\/$/, '');
  }

  async _get(endpoint, params) {
    const url = new URL(`${this.baseUrl}/${endpoint}`);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(url.toString(), { signal: controller.signal });

      if (!res.ok) {
        throw new Error(`CRM API error: ${res.status} ${res.statusText} for ${endpoint}`);
      }

      const data = await res.json();

      if (!data.success) {
        throw new Error(`CRM API returned success=false for ${endpoint}: ${JSON.stringify(data)}`);
      }

      return data;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(`CRM API timeout (${TIMEOUT_MS}ms) for ${endpoint} with params ${JSON.stringify(params)}`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async fetchOrders(date, shopCode) {
    const data = await this._get('trans-by-day', { date, shopCode });
    if (!data.orders || data.orders.length === 0) {
      throw new Error(`No orders found for ${shopCode} on ${date}`);
    }
    return data;
  }

  async fetchCounters(date, shopCode) {
    const data = await this._get('counters-by-day', { date, shopCode });
    if (!data.counters || data.counters.length === 0) {
      throw new Error(`No counters found for ${shopCode} on ${date}`);
    }
    return data;
  }
}
