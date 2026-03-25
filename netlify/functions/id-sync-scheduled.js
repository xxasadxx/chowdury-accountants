// InformDirect Nightly Sync — runs at 5:30am daily
// Fetches companies from InformDirect, updates director names and CS dates in Supabase

const ID_KEY    = 'Hufg9zYb8XwNQ8ZJ6hRcEKpGC9y3P8leCtCg9SnWMOXSndaCB1ZgXVE6eIN9b4va';
const ID_BASE   = 'https://api.informdirect.co.uk';
const SB_URL    = 'https://yhvhpfsoqtjwnukgyqap.supabase.co';
const SB_KEY    = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlodmhwZnNvcXRqd251a2d5cWFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1MzUzODQsImV4cCI6MjA4ODExMTM4NH0.QDTVLU0vNRc3WJfYTOOG3ct9G2Ywgd49dC5hr6to3P4';

const https = require('https');

function httpRequest(options, body) {
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

function sbRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const options = {
      hostname: new URL(SB_URL).hostname,
      path: '/rest/v1/' + path,
      method,
      headers: {
        'apikey': SB_KEY,
        'Authorization': 'Bearer ' + SB_KEY,
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

function toDisplayDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}

exports.handler = async () => {
  console.log('ID sync started at', new Date().toISOString());

  try {
    // 1. Authenticate with InformDirect
    const authUrl = new URL(ID_BASE + '/authenticate');
    const authBody = JSON.stringify({ apiKey: ID_KEY });
    const authResp = await httpRequest({
      hostname: authUrl.hostname,
      path: authUrl.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(authBody)
      }
    }, authBody);

    const authData = JSON.parse(authResp.body);
    const token = authData.accessToken || authData.AccessToken;
    if (!token) throw new Error('Auth failed: ' + authResp.body.slice(0, 200));
    console.log('Authenticated with InformDirect');

    // 2. Fetch all companies from InformDirect
    const compUrl = new URL(ID_BASE + '/companies');
    const compResp = await httpRequest({
      hostname: compUrl.hostname,
      path: compUrl.pathname,
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token }
    });

    const compData = JSON.parse(compResp.body);
    const companies = Array.isArray(compData) ? compData : (compData.companies || compData.Companies || compData.data || []);
    console.log(`Fetched ${companies.length} companies from InformDirect`);

    // 3. Fetch existing ltd_clients from Supabase
    const clientsResp = await sbRequest('GET', 'ltd_clients?select=id,comp_no,director_name,conf_due&status=eq.active&limit=1000');
    const clients = JSON.parse(clientsResp.body);
    console.log(`Loaded ${clients.length} active clients from Supabase`);

    // Build lookup map by company number
    const clientMap = {};
    clients.forEach(c => {
      if (c.comp_no) clientMap[c.comp_no.toUpperCase().replace(/\s/g, '')] = c;
    });

    // 4. Match and build updates
    const updates = [];
    let matched = 0, updated = 0;

    for (const c of companies) {
      const compNo = (c.companyNumber || c.CompanyNumber || c.company_number || '').replace(/\s/g, '').toUpperCase();
      if (!compNo) continue;

      const local = clientMap[compNo];
      if (!local) continue;
      matched++;

      const patch = { id: local.id };
      let changed = false;

      // Director name — only update if missing
      const officers = c.officers || c.Officers || c.directors || [];
      const director = Array.isArray(officers) && officers.find(o =>
        (o.role || o.Role || o.officerRole || '').toLowerCase().includes('director')
      );
      if (director && !local.director_name) {
        const name = [
          (director.forename || director.firstName || director.Forename || ''),
          (director.surname || director.lastName || director.Surname || '')
        ].join(' ').trim() || director.name || director.Name || '';
        if (name) { patch.director_name = name; changed = true; }
      }

      // CS due date — update if InformDirect has it
      const csDate = c.nextConfirmationStatementDate || c.confirmationStatementDueDate || c.NextCSDate || '';
      if (csDate) {
        const display = toDisplayDate(csDate);
        if (display && display !== local.conf_due) {
          patch.conf_due = display;
          changed = true;
        }
      }

      if (changed) { updates.push(patch); updated++; }
    }

    console.log(`Matched: ${matched}, Updates needed: ${updated}`);

    // 5. Apply updates in batches
    for (let i = 0; i < updates.length; i += 50) {
      const batch = updates.slice(i, i + 50);
      await sbRequest('POST', 'ltd_clients', batch);
    }

    const summary = `ID sync complete: ${companies.length} from ID, ${matched} matched, ${updated} updated`;
    console.log(summary);
    return { statusCode: 200, body: JSON.stringify({ success: true, summary }) };

  } catch(e) {
    console.error('ID sync failed:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
