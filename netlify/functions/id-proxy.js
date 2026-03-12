// Netlify function: proxy for Inform Direct API (avoids CORS)
// Endpoints: /authenticate, /companies, /company (GET/POST/DELETE)

const SANDBOX_BASE = 'https://sandbox-api.informdirect.co.uk';
const PROD_BASE    = 'https://api.informdirect.co.uk';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const params = event.queryStringParameters || {};
    const env      = params.env === 'production' ? PROD_BASE : SANDBOX_BASE;
    const endpoint = params.endpoint || '';
    const method   = (params.method || event.httpMethod || 'GET').toUpperCase();
    const token    = params.token || '';

    if (!endpoint) return { statusCode: 400, headers, body: JSON.stringify({ error: 'endpoint required' }) };

    let url = env + '/' + endpoint;
    // Pass through any extra query params (e.g. companyNumber)
    const extraParams = Object.entries(params)
      .filter(([k]) => !['env','endpoint','method','token'].includes(k))
      .map(([k,v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    if (extraParams) url += '?' + extraParams;

    const fetchOpts = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (token) fetchOpts.headers['Authorization'] = 'Bearer ' + token;
    if (['POST','PUT'].includes(method) && event.body) fetchOpts.body = event.body;

    const res = await fetch(url, fetchOpts);
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }

    return { statusCode: res.status, headers, body: JSON.stringify(body) };

  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
