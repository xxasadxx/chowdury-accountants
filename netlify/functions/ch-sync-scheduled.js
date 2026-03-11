const https = require('https');

const CH_API_KEY = '4ec759f4-152c-4680-9f8e-7ab1312aea1a';
const SUPABASE_URL = 'https://yhvhpfsoqtjwnukgyqap.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlodmhwZnNvcXRqd251a2d5cWFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1MzUzODQsImV4cCI6MjA4ODExMTM4NH0.QDTVLU0vNRc3WJfYTOOG3ct9G2Ywgd49dC5hr6to3P4';

// Fetch from Companies House API
function fetchCH(compNo) {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(CH_API_KEY + ':').toString('base64');
    const options = {
      hostname: 'api.company-information.service.gov.uk',
      path: '/company/' + encodeURIComponent(compNo),
      headers: { 'Authorization': 'Basic ' + auth }
    };
    const req = https.get(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Fetch from Supabase
function sbGet(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(SUPABASE_URL + '/rest/v1/' + path);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY
      }
    };
    const req = https.get(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// POST/upsert to Supabase
function sbPost(path, data, prefer = 'resolution=merge-duplicates') {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const options = {
      hostname: new URL(SUPABASE_URL).hostname,
      path: '/rest/v1/' + path,
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json',
        'Prefer': prefer,
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (res) => {
      let b = '';
      res.on('data', chunk => b += chunk);
      res.on('end', () => resolve(b));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function chDateToDisplay(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

// Main scheduled handler - runs at midnight
exports.handler = async () => {
  console.log('CH auto-sync started at', new Date().toISOString());

  try {
    // Load all seed files to get comp_nos
    const seedFiles = [];
    for (let i = 0; i <= 6; i++) {
      try {
        const r = await fetch(`https://chowdury-accountants.netlify.app/ltd-seed-${i}.json`);
        const data = await r.json();
        seedFiles.push(...data);
      } catch(e) {
        console.warn(`Could not load seed ${i}:`, e.message);
      }
    }

    // Also get any companies saved in ltd_clients
    const ltdClients = await sbGet('ltd_clients?select=comp_no,status&limit=1000');
    const leftComps = new Set((ltdClients || []).filter(r => r.status === 'left' || r.status === 'ceased').map(r => r.comp_no));

    // Get active companies with comp_no
    const companies = seedFiles.filter(c => c.comp_no && c.comp_no.trim() && !leftComps.has(c.comp_no));
    console.log(`Syncing ${companies.length} active companies`);

    const today = new Date(); today.setHours(0,0,0,0);
    const updates = [];
    let done = 0, errors = 0;

    for (const c of companies) {
      try {
        const data = await fetchCH(c.comp_no);
        const accDue = data.accounts?.next_due ? chDateToDisplay(data.accounts.next_due) : '';
        const accRef = data.accounts?.next_made_up_to ? chDateToDisplay(data.accounts.next_made_up_to) : '';
        const confDue = data.confirmation_statement?.next_due ? chDateToDisplay(data.confirmation_statement.next_due) : '';
        const confDate = data.confirmation_statement?.last_made_up_to ? chDateToDisplay(data.confirmation_statement.last_made_up_to) : '';

        const aD = accDue ? new Date(accDue.split('/').reverse().join('-')) : null;
        const cD = confDue ? new Date(confDue.split('/').reverse().join('-')) : null;
        const overdue = (aD && aD < today) || (cD && cD < today);
        const soon60 = (aD && (aD - today) / 86400000 <= 60) || (cD && (cD - today) / 86400000 <= 60);
        let alert = '';
        if (overdue) alert = 'Red';
        else if (soon60) alert = 'Amber';
        else if (data.accounts?.last_made_up_to) alert = 'Green';

        updates.push({ comp_no: c.comp_no, accounts_due: accDue, accounts_ref_date: accRef, conf_due: confDue, conf_date: confDate, alerts: alert, synced_at: new Date().toISOString() });
        done++;
      } catch(e) {
        errors++;
      }

      // Throttle - 20 requests then short pause
      if ((done + errors) % 20 === 0) {
        await new Promise(res => setTimeout(res, 200));
      }
    }

    // Save to ltd_ch_cache in batches of 50
    for (let i = 0; i < updates.length; i += 50) {
      await sbPost('ltd_ch_cache', updates.slice(i, i + 50));
    }

    const summary = `CH auto-sync complete: ${done} synced, ${errors} errors at ${new Date().toISOString()}`;
    console.log(summary);

    return { statusCode: 200, body: JSON.stringify({ success: true, synced: done, errors, timestamp: new Date().toISOString() }) };

  } catch(e) {
    console.error('CH auto-sync failed:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
