// InformDirect Manual Sync — called from Sync ID button in Ltd Tracker
// 1. Updates existing records — director names and CS dates
// 2. AUTO-CREATES new companies not yet in the portal
// 3. AUTO-INACTIVATES companies that are struck off / dissolved

const ID_KEY = 'Hufg9zYb8XwNQ8ZJ6hRcEKpGC9y3P8leCtCg9SnWMOXSndaCB1ZgXVE6eIN9b4va';
const ID_BASE = 'https://api.informdirect.co.uk';
const CH_KEY = '4ec759f4-152c-4680-9f8e-7ab1312aea1a';
const SB_URL = 'https://yhvhpfsoqtjwnukgyqap.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlodmhwZnNvcXRqd251a2d5cWFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1MzUzODQsImV4cCI6MjA4ODExMTM4NH0.QDTVLU0vNRc3WJfYTOOG3ct9G2Ywgd49dC5hr6to3P4';

const https = require('https');

// Statuses from InformDirect/CH that mean company should be inactive
const INACTIVE_STATUSES = [
  'dissolved', 'struck off', 'strike off', 'proposal to strike',
  'proposal to strike off', 'liquidation', 'receivership',
  'administration', 'voluntary arrangement', 'converted-closed', 'closed'
];

function isInactiveStatus(status) {
  const s = (status || '').toLowerCase();
  return INACTIVE_STATUSES.some(x => s.includes(x));
}

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

function sbRequest(method, path, body, prefer) {
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
        'Prefer': prefer || (method === 'GET' ? 'count=none' : 'resolution=merge-duplicates'),
        ...(method === 'GET' ? { 'Range': '0-9999' } : {}),
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

function fetchCH(compNo) {
  return new Promise((resolve) => {
    const auth = Buffer.from(CH_KEY + ':').toString('base64');
    const options = {
      hostname: 'api.company-information.service.gov.uk',
      path: '/company/' + encodeURIComponent(compNo),
      headers: { 'Authorization': 'Basic ' + auth }
    };
    const req = https.get(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

function toDisplayDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}

function chDateToDisplay(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

exports.handler = async () => {
  console.log('ID sync started at', new Date().toISOString());

  try {
    // 1. Authenticate with InformDirect
    const authBody = JSON.stringify({ apiKey: ID_KEY });
    const authUrl = new URL(ID_BASE + '/authenticate');
    const authResp = await httpRequest({
      hostname: authUrl.hostname,
      path: authUrl.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(authBody) }
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
    const clientsResp = await sbRequest('GET', 'ltd_clients?select=id,comp_no,company_name,director_name,conf_due,status&limit=2000');
    let clients;
    try { clients = JSON.parse(clientsResp.body); } catch(e) { clients = []; }
    if (!Array.isArray(clients)) {
      console.error('Supabase clients error:', clientsResp.body);
      clients = [];
    }
    console.log(`Loaded ${clients.length} clients from Supabase`);

    const clientMap = {};
    clients.forEach(c => {
      if (c.comp_no) clientMap[c.comp_no.toUpperCase().replace(/\s/g, '')] = c;
    });

    // 4. Process each company
    const updates = [];
    const newCompanies = [];
    const inactivated = [];
    let matched = 0, updated = 0, created = 0, deactivated = 0;

    for (const c of companies) {
      const compNo = (c.companyNumber || c.CompanyNumber || c.company_number || '').replace(/\s/g, '').toUpperCase();
      if (!compNo) continue;

      const idStatus = (c.status || c.Status || c.companyStatus || '').toLowerCase();

      // Skip formations not yet registered at CH
      if (idStatus === 'formation' || idStatus === 'pending' || idStatus === 'awaiting') continue;

      const local = clientMap[compNo];

      // ── AUTO-INACTIVATE: struck off / dissolved / proposal to strike off ──
      if (local && local.status === 'active' && isInactiveStatus(idStatus)) {
        console.log(`⚠️ Auto-inactivating: ${local.company_name} (${compNo}) — status: ${idStatus}`);
        updates.push({
          id: local.id,
          status: 'left',
          notes: `Auto-inactivated by sync: ${idStatus} (${new Date().toISOString().slice(0,10)})`
        });
        inactivated.push(local.company_name || compNo);
        deactivated++;
        continue;
      }

      // Director name
      const officers = c.officers || c.Officers || c.directors || [];
      const director = Array.isArray(officers) && officers.find(o =>
        (o.role || o.Role || o.officerRole || '').toLowerCase().includes('director')
      );
      const directorName = director ? (
        [(director.forename || director.firstName || director.Forename || ''),
         (director.surname || director.lastName || director.Surname || '')
        ].join(' ').trim() || director.name || director.Name || ''
      ) : '';

      // CS due date
      const csDateRaw = c.nextConfirmationStatementDate || c.confirmationStatementDueDate || c.NextCSDate || '';
      const csDate = csDateRaw ? toDisplayDate(csDateRaw) : '';

      if (local) {
        // UPDATE existing record
        matched++;
        const patch = { id: local.id };
        let changed = false;
        if (directorName && !local.director_name) { patch.director_name = directorName; changed = true; }
        if (csDate && csDate !== local.conf_due) { patch.conf_due = csDate; changed = true; }
        if (changed) { updates.push(patch); updated++; }

      } else {
        // NEW company — get full details from Companies House
        console.log(`New company: ${compNo}`);
        const chData = await fetchCH(compNo);
        await new Promise(r => setTimeout(r, 150));

        // Only add if CH confirms it's active
        if (!chData || isInactiveStatus(chData.company_status || '')) continue;

        const companyName = c.companyName || c.CompanyName || c.name || chData.company_name || compNo;
        const accDue = chData.accounts && chData.accounts.next_due ? chDateToDisplay(chData.accounts.next_due) : '';
        const accRef = chData.accounts && chData.accounts.next_made_up_to ? chDateToDisplay(chData.accounts.next_made_up_to) : '';
        const confDue = chData.confirmation_statement && chData.confirmation_statement.next_due
          ? chDateToDisplay(chData.confirmation_statement.next_due) : (csDate || '');
        const incDate = chData.date_of_creation ? chDateToDisplay(chData.date_of_creation) : '';

        newCompanies.push({
          company_name: companyName,
          comp_no: compNo,
          status: 'active',
          director_name: directorName || '',
          accounts_due: accDue,
          accounts_ref_date: accRef,
          conf_due: confDue,
          inc_date: incDate,
          sector: 'Hospitality',
          source: 'auto-informdirect',
          created_at: new Date().toISOString()
        });
        created++;
      }
    }

    // AUTO-INACTIVATE: active portal clients no longer in InformDirect
    const idCompNos = new Set(
      companies
        .map(c => (c.companyNumber || c.CompanyNumber || c.company_number || '').replace(/\s/g, '').toUpperCase())
        .filter(Boolean)
    );
    const removedFromID = clients.filter(c =>
      c.status === 'active' && c.comp_no &&
      !idCompNos.has(c.comp_no.toUpperCase().replace(/\s/g, ''))
    );
    for (const c of removedFromID) {
      console.log(`Removed from InformDirect: ${c.company_name} (${c.comp_no})`);
      updates.push({ id: c.id, status: 'left', notes: `Auto-inactivated: removed from InformDirect (${new Date().toISOString().slice(0,10)})` });
      inactivated.push(c.company_name || c.comp_no);
      deactivated++;
    }

    console.log(`Matched: ${matched}, Updated: ${updated}, New: ${created}, Deactivated: ${deactivated}`);
    if (inactivated.length) console.log('Inactivated:', inactivated.join(', '));

    // 5. Apply all updates (includes inactivations)
    for (let i = 0; i < updates.length; i += 50) {
      await sbRequest('POST', 'ltd_clients', updates.slice(i, i + 50));
    }

    // 6. Insert new companies
    for (let i = 0; i < newCompanies.length; i += 50) {
      await sbRequest('POST', 'ltd_clients', newCompanies.slice(i, i + 50), 'return=minimal');
    }

    const summary = `ID sync complete: ${companies.length} from InformDirect | ${matched} matched | ${updated} updated | ${created} NEW added | ${deactivated} auto-inactivated`;
    console.log(summary);
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        summary,
        new_companies: newCompanies.map(c => c.company_name),
        inactivated
      })
    };

  } catch(e) {
    console.error('ID sync failed:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
