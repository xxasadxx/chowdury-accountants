// GoCardless Sync — runs at 5am and 3pm daily
const GC_TOKEN = process.env.GOCARDLESS_TOKEN;
const GC_BASE  = 'https://api.gocardless.com';
const GC_VER   = '2015-07-06';
const SB_URL   = 'https://yhvhpfsoqtjwnukgyqap.supabase.co';
const SB_KEY   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlodmhwZnNvcXRqd251a2d5cWFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1MzUzODQsImV4cCI6MjA4ODExMTM4NH0.QDTVLU0vNRc3WJfYTOOG3ct9G2Ywgd49dC5hr6to3P4';
const https = require('https');

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function monthLabel(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear();
}
function monthKey(dateStr) {
  return dateStr ? dateStr.substring(0, 7) : null;
}

function gcFetch(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(GC_BASE + path);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: { 'Authorization': 'Bearer ' + GC_TOKEN, 'GoCardless-Version': GC_VER }
    };
    const req = https.get(options, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(body) }); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.end();
  });
}

async function gcFetchAll(resource, params = {}) {
  let results = [], after = null;
  do {
    let path = `/${resource}?limit=500`;
    Object.keys(params).forEach(k => { if (params[k]) path += `&${k}=${encodeURIComponent(params[k])}`; });
    if (after) path += `&after=${after}`;
    const resp = await gcFetch(path);
    if (resp.status !== 200) throw new Error(`GC ${resource} error ${resp.status}`);
    const items = resp.data[resource] || [];
    results = results.concat(items);
    const meta = resp.data.meta;
    after = (meta && meta.cursors && meta.cursors.after) ? meta.cursors.after : null;
  } while (after);
  return results;
}

function sbRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const options = {
      hostname: new URL(SB_URL).hostname,
      path: '/rest/v1/' + path,
      method,
      headers: {
        'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {})
      }
    };
    const req = https.request(options, (res) => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function sbUpsert(table, rows) {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += 200) {
    await sbRequest('POST', table, rows.slice(i, i + 200));
  }
}

async function sbGet(path) {
  const r = await sbRequest('GET', path, null);
  try { return JSON.parse(r.body); } catch(e) { return []; }
}

exports.handler = async () => {
  if (!GC_TOKEN) return { statusCode: 500, body: 'GOCARDLESS_TOKEN not set' };
  console.log('GC sync started at', new Date().toISOString());
  const log = [];

  try {
    // 1. Fetch customers
    const customers = await gcFetchAll('customers');
    log.push(`Customers: ${customers.length}`);
    const custRows = customers.map(c => ({
      gc_id: c.id, email: c.email || '',
      given_name: c.given_name || '', family_name: c.family_name || '',
      company_name: c.company_name || '', created_at: c.created_at
    }));
    await sbUpsert('gc_customers', custRows);

    // Build customer name map
    const custMap = {};
    customers.forEach(c => {
      custMap[c.id] = (c.company_name || (c.given_name + ' ' + c.family_name)).trim();
    });

    // 2. Fetch mandates
    const mandates = await gcFetchAll('mandates');
    const activeMandates = mandates.filter(m => m.status === 'active');
    await sbUpsert('gc_mandates', mandates.map(m => ({
      gc_id: m.id, status: m.status,
      customer_id: m.links && m.links.customer, created_at: m.created_at
    })));
    log.push(`Mandates: ${mandates.length} (${activeMandates.length} active)`);

    // 3. Fetch recent payments (last 3 months)
    const since = new Date();
    since.setMonth(since.getMonth() - 3);
    const payments = await gcFetchAll('payments', { 'created_at[gte]': since.toISOString() });
    log.push(`Payments: ${payments.length}`);

    await sbUpsert('gc_payments', payments.map(p => ({
      gc_id: p.id, amount: p.amount / 100, status: p.status,
      charge_date: p.charge_date, description: p.description || '',
      customer_id: p.links && p.links.customer,
      created_at: p.created_at, month_key: monthKey(p.charge_date)
    })));

    // 4. Auto-update payment_history in Supabase
    // Fetch all DD clients from Gocardless tracker
    const ddClients = await sbGet('Gocardless%20tracker?select=id,company_name,fee,charge_date&status=neq.inactive');
    log.push(`DD clients: ${ddClients.length}`);

    // Build name lookup (normalised)
    const norm = s => (s || '').toLowerCase().replace(/\s+/g,' ').replace(/[^a-z0-9 ]/g,'').trim();
    const clientByName = {};
    ddClients.forEach(c => { clientByName[norm(c.company_name)] = c; });

    // Group payments by customer and month
    const payByMonth = {};
    payments.forEach(p => {
      const ml = monthLabel(p.charge_date);
      const cname = norm(custMap[p.customer_id] || '');
      if (!ml || !cname) return;
      const key = cname + '|' + ml;
      if (!payByMonth[key]) payByMonth[key] = { status: p.status, amount: p.amount / 100, cname, ml };
      else if (p.status === 'paid_out' || p.status === 'confirmed') payByMonth[key].status = p.status;
    });

    // Upsert payment_history for matched clients
    let updated = 0;
    for (const [key, pay] of Object.entries(payByMonth)) {
      const client = clientByName[pay.cname];
      if (!client) continue;
      const gcStatus = (pay.status === 'paid_out' || pay.status === 'confirmed') ? 'paid' : 
                       (pay.status === 'failed' || pay.status === 'cancelled') ? 'failed' : 'pending';
      // Check if record exists
      const existing = await sbGet(`payment_history?client_id=eq.${client.id}&client_type=eq.dd&month=eq.${encodeURIComponent(pay.ml)}`);
      if (existing && existing.length > 0) {
        await sbRequest('PATCH', `payment_history?id=eq.${existing[0].id}`, { status: gcStatus, received: gcStatus === 'paid' ? pay.amount : 0 });
      } else {
        await sbRequest('POST', 'payment_history', [{ client_id: client.id, client_type: 'dd', month: pay.ml, expected: client.fee, received: gcStatus === 'paid' ? pay.amount : 0, status: gcStatus }]);
      }
      updated++;
    }
    log.push(`payment_history updated: ${updated} records`);

    // 5. Monthly summary
    const allPaid = payments.filter(p => p.status === 'paid_out' || p.status === 'confirmed');
    const summary = {};
    allPaid.forEach(p => {
      const k = monthKey(p.charge_date);
      if (!k) return;
      if (!summary[k]) summary[k] = { month: k, total: 0, count: 0 };
      summary[k].total += p.amount / 100;
      summary[k].count++;
    });
    await sbUpsert('gc_monthly_summary', Object.values(summary).map(m => ({
      month: m.month, total_revenue: Math.round(m.total * 100) / 100, payment_count: m.count
    })));

    log.push('Done');
    return { statusCode: 200, body: JSON.stringify({ success: true, log }) };

  } catch(e) {
    console.error('GC sync failed:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message, log }) };
  }
};
