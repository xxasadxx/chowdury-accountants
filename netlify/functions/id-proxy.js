// Netlify function: proxy for Inform Direct API (avoids CORS)
const https = require('https');

const SANDBOX_BASE = 'sandbox-api.informdirect.co.uk';
const PROD_BASE    = 'api.informdirect.co.uk';

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const params   = event.queryStringParameters || {};
    const host     = params.env === 'production' ? PROD_BASE : SANDBOX_BASE;
    const endpoint = params.endpoint || '';
    const method   = (params.method || 'GET').toUpperCase();
    const token    = params.token || '';

    if (!endpoint) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'endpoint required' }) };
    }

    const extraParams = Object.entries(params)
      .filter(([k]) => !['env','endpoint','method','token'].includes(k))
      .map(([k,v]) => k + '=' + encodeURIComponent(v)).join('&');

    let path = '/' + endpoint;
    if (extraParams) path += '?' + extraParams;

    const reqHeaders = { 'Content-Type': 'application/json' };
    if (token) reqHeaders['Authorization'] = 'Bearer ' + token;

    let bodyStr = null;
    if (['POST','PUT'].includes(method) && event.body) {
      bodyStr = event.body;
      reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const options = { hostname: host, path, method, headers: reqHeaders };
    const result  = await httpsRequest(options, bodyStr);

    let parsed;
    try { parsed = JSON.parse(result.body); }
    catch { parsed = { raw: result.body }; }

    return { statusCode: result.status, headers: corsHeaders, body: JSON.stringify(parsed) };

  } catch (e) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: e.message }) };
  }
};
