// GoCardless Nightly Sync — runs at 5am daily
// Fetches live payments, customers, mandates from GoCardless
// Upserts into Supabase tables: gc_payments, gc_customers, gc_mandates
// Also updates gc_monthly_summary for the Revenue Tracker

const GC_TOKEN  = 'live_zTE6grGCyTMR4tobPZ1shAuALQeirL622mFy78Zs';
const GC_BASE   = 'https://api.gocardless.com';
const GC_VER    = '2015-07-06';
const SB_URL    = 'https://yhvhpfsoqtjwnukgyqap.supabase.co';
const SB_KEY    = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlodmhwZnNvcXRqd251a2d5cWFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1MzUzODQsImV4cCI6MjA4ODExMTM4NH0.QDTVLU0vNRc3WJfYTOOG3ct9G2Ywgd49dC5hr6to3P4';

const https = require('https');

// ── Helpers ──────────────────────────────────────────────────────────────────

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
  // Batch in chunks of 200
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    await sbRequest('POST', table, chunk);
  }
}

function monthKey(dateStr) {
  // Returns YYYY-MM from an ISO date string
  return dateStr ? dateStr.substring(0, 7) : null;
}

// ── Main handler ─────────────────────────────────────────────────────────────

exports.handler = async () => {
  console.log('GC sync started at', new Date().toISOString());
  const log = [];

  try {
    // 1. Fetch customers
    log.push('Fetching customers...');
    const customers = await gcFetchAll('customers');
    log.push(`Customers: ${customers.length}`);

    const custRows = customers.map(c => ({
      gc_id: c.id,
      email: c.email || '',
      given_name: c.given_name || '',
      family_name: c.family_name || '',
      company_name: c.company_name || '',
      created_at: c.created_at,
      metadata: c.metadata ? JSON.stringify(c.metadata) : null
    }));
    await sbUpsert('gc_customers', custRows);
    log.push('Customers upserted');

    // 2. Fetch mandates
    log.push('Fetching mandates...');
    const mandates = await gcFetchAll('mandates');
    log.push(`Mandates: ${mandates.length}`);

    const activeMandates = mandates.filter(m => m.status === 'active');
    const mandateRows = mandates.map(m => ({
      gc_id: m.id,
      status: m.status,
      customer_id: m.links && m.links.customer,
      created_at: m.created_at,
      next_possible_charge_date: m.next_possible_charge_date || null
    }));
    await sbUpsert('gc_mandates', mandateRows);
    log.push(`Mandates upserted (${activeMandates.length} active)`);

    // 3. Fetch payments (last 24 months)
    log.push('Fetching payments...');
    const since = new Date();
    since.setMonth(since.getMonth() - 24);
    const payments = await gcFetchAll('payments', { 'created_at[gte]': since.toISOString() });
    log.push(`Payments: ${payments.length}`);

    const paymentRows = payments.map(p => ({
      gc_id: p.id,
      amount: p.amount / 100, // GC stores in pence
      status: p.status,
      charge_date: p.charge_date,
      description: p.description || '',
      customer_id: p.links && p.links.customer,
      mandate_id: p.links && p.links.mandate,
      created_at: p.created_at,
      month_key: monthKey(p.charge_date)
    }));
    await sbUpsert('gc_payments', paymentRows);
    log.push('Payments upserted');

    // 4. Build monthly summary from paid payments only
    const paidPayments = paymentRows.filter(p => p.status === 'paid_out' || p.status === 'confirmed');
    const monthlySummary = {};
    paidPayments.forEach(p => {
      if (!p.month_key) return;
      if (!monthlySummary[p.month_key]) monthlySummary[p.month_key] = { month: p.month_key, total: 0, count: 0, customers: new Set() };
      monthlySummary[p.month_key].total += p.amount;
      monthlySummary[p.month_key].count++;
      if (p.customer_id) monthlySummary[p.month_key].customers.add(p.customer_id);
    });

    const summaryRows = Object.values(monthlySummary).map(m => ({
      month: m.month,
      total_revenue: Math.round(m.total * 100) / 100,
      payment_count: m.count,
      active_customers: m.customers.size
    }));
    await sbUpsert('gc_monthly_summary', summaryRows);
    log.push(`Monthly summary: ${summaryRows.length} months`);

    // 5. Save sync metadata
    await sbRequest('POST', 'gc_sync_log', [{
      synced_at: new Date().toISOString(),
      customers: customers.length,
      active_mandates: activeMandates.length,
      payments_synced: payments.length,
      status: 'success',
      log: log.join(' | ')
    }]);

    const summary = `GC sync complete: ${customers.length} customers, ${activeMandates.length} active mandates, ${payments.length} payments`;
    console.log(summary);
    return { statusCode: 200, body: JSON.stringify({ success: true, summary, log }) };

  } catch(e) {
    console.error('GC sync failed:', e.message);
    await sbRequest('POST', 'gc_sync_log', [{
      synced_at: new Date().toISOString(),
      status: 'error',
      log: e.message
    }]).catch(() => {});
    return { statusCode: 500, body: JSON.stringify({ error: e.message, log }) };
  }
};
