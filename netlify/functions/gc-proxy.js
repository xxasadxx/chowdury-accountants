// GoCardless Live API Proxy
// Proxies requests to GoCardless API to avoid CORS issues
// Called from the frontend as: /.netlify/functions/gc-proxy?endpoint=payments&after=2026-01-01

const GC_TOKEN = 'live_zTE6grGCyTMR4tobPZ1shAuALQeirL622mFy78Zs';
const GC_BASE  = 'https://api.gocardless.com';
const GC_VER   = '2015-07-06';

const ALLOWED_ENDPOINTS = [
  'payments', 'customers', 'mandates', 'subscriptions',
  'payouts', 'events', 'customer_bank_accounts'
];

const https = require('https');

function gcFetch(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(GC_BASE + path);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: {
        'Authorization': 'Bearer ' + GC_TOKEN,
        'GoCardless-Version': GC_VER,
        'Content-Type': 'application/json'
      }
    };
    const req = https.get(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Fetch all pages of a resource
async function fetchAll(resource, params = {}) {
  let results = [];
  let after = null;
  const limit = 500;

  do {
    let path = `/${resource}?limit=${limit}`;
    Object.keys(params).forEach(k => { if (params[k]) path += `&${k}=${params[k]}`; });
    if (after) path += `&after=${after}`;

    const resp = await gcFetch(path);
    if (resp.status !== 200) throw new Error(`GC API error ${resp.status}: ${JSON.stringify(resp.data)}`);

    const items = resp.data[resource] || [];
    results = results.concat(items);

    const meta = resp.data.meta;
    after = (meta && meta.cursors && meta.cursors.after) ? meta.cursors.after : null;
  } while (after);

  return results;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    const params = event.queryStringParameters || {};
    const endpoint = params.endpoint;

    if (!endpoint || !ALLOWED_ENDPOINTS.includes(endpoint)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid endpoint' }) };
    }

    // Build query params for GC (pass through any filters)
    const gcParams = {};
    ['status', 'customer', 'mandate', 'created_at[gte]', 'created_at[lte]', 'charge_date[gte]'].forEach(k => {
      if (params[k]) gcParams[k] = params[k];
    });

    const items = await fetchAll(endpoint, gcParams);
    return { statusCode: 200, headers, body: JSON.stringify({ [endpoint]: items, count: items.length }) };

  } catch(e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
