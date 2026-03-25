// Nightly DB Backup — runs at 2:00am daily
// Reads all critical tables from Supabase and stores a JSON snapshot
// in the db_backups table. Keeps a rolling 30-day history.
// Run SQL from backup-setup.sql in Supabase editor first to create the table.

const SB_URL = 'https://yhvhpfsoqtjwnukgyqap.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlodmhwZnNvcXRqd251a2d5cWFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1MzUzODQsImV4cCI6MjA4ODExMTM4NH0.QDTVLU0vNRc3WJfYTOOG3ct9G2Ywgd49dC5hr6to3P4';

const https = require('https');

const TABLES = [
  { name: 'ltd_clients',        limit: 2000 },
  { name: 'vat_clients',        limit: 1000 },
  { name: 'paye_employers',     limit: 1000 },
  { name: 'sa_clients',         limit: 1000 },
  { name: 'onboarding_clients', limit: 500  },
  { name: 'appointments',       limit: 500  },
  { name: 'saved_templates',    limit: 200  },
  { name: 'staff_activities',   limit: 2000 },
  { name: 'client_messages',    limit: 2000 },
];

function sbRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(SB_URL + '/rest/v1/' + path);
    const bodyStr = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'apikey': SB_KEY,
        'Authorization': 'Bearer ' + SB_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      }
    };
    if (bodyStr) opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: data ? JSON.parse(data) : null }); }
        catch(e) { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

exports.handler = async function() {
  const log = [];
  const snapshot = {};
  const backedAt = new Date().toISOString();
  let totalRows = 0;

  try {
    // 1. Read all critical tables
    for (const t of TABLES) {
      try {
        const r = await sbRequest('GET', `${t.name}?select=*&limit=${t.limit}&order=id.asc`);
        const rows = Array.isArray(r.data) ? r.data : [];
        snapshot[t.name] = rows;
        totalRows += rows.length;
        log.push(`${t.name}: ${rows.length} rows`);
      } catch(e) {
        log.push(`${t.name}: ERROR - ${e.message}`);
        snapshot[t.name] = [];
      }
    }

    // 2. Write snapshot to db_backups
    const snapshotStr = JSON.stringify(snapshot);
    const sizeKb = Math.round(Buffer.byteLength(snapshotStr) / 1024);

    const ins = await sbRequest('POST', 'db_backups', {
      backed_at: backedAt,
      tables: TABLES.map(t => t.name).join(','),
      total_rows: totalRows,
      size_kb: sizeKb,
      status: 'success',
      log: log.join(' | '),
      snapshot: snapshotStr
    });

    if (ins.status > 299) {
      throw new Error(`Insert failed (${ins.status}): ${JSON.stringify(ins.data)}`);
    }

    // 3. Purge backups older than 30 days
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    await sbRequest('DELETE', `db_backups?backed_at=lt.${cutoff}`);

    const summary = `Backup OK: ${totalRows} rows across ${TABLES.length} tables (${sizeKb}KB)`;
    console.log(summary);
    return { statusCode: 200, body: JSON.stringify({ success: true, summary, log }) };

  } catch(e) {
    console.error('Backup failed:', e.message);
    // Try to log the failure
    await sbRequest('POST', 'db_backups', {
      backed_at: backedAt,
      status: 'error',
      log: e.message,
      total_rows: 0,
      size_kb: 0,
      snapshot: '{}'
    }).catch(() => {});
    return { statusCode: 500, body: JSON.stringify({ error: e.message, log }) };
  }
};
