// Netlify Function: send-email.js
// Sends branded HTML emails via Resend API
// Handles: portal invites, document approval requests, reminders

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Email service not configured' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request' }) }; }

  const { type, to, name, company, link, period, documents } = body;
  if (!type || !to) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  // ── EMAIL TEMPLATES ──────────────────────────────────
  const FIRM = 'Chowdury Accountants';
  const FROM = 'Chowdury Accountants <noreply@chowduryaccountants.co.uk>';
  const REPLY = 'info@chowduryaccountants.co.uk';
  const TEL = '0161 222 4647';
  const ADDR = '283 Featherstall Road North, Oldham, OL1 2NH';
  const LOGO_URL = 'https://chowdury-accountants.netlify.app/ca-logo.png';

  const baseStyle = `
    body{margin:0;padding:0;background:#f0f2f5;font-family:'Segoe UI',Arial,sans-serif}
    .wrap{max-width:600px;margin:0 auto;background:#fff}
    .band{height:4px;background:#c8963c}
    .header{background:#1a1a18;padding:20px 32px;display:flex;align-items:center;justify-content:space-between}
    .header img{height:40px}
    .header-contact{color:rgba(255,255,255,.5);font-size:12px;text-align:right;line-height:1.6}
    .header-contact a{color:#c8963c;text-decoration:none}
    .hero{background:#1a1a18;padding:28px 32px 32px;border-top:1px solid rgba(255,255,255,.06)}
    .hero h1{color:#fff;font-size:22px;font-weight:800;margin:0 0 6px}
    .hero p{color:rgba(255,255,255,.5);font-size:13px;margin:0}
    .body{padding:32px}
    .body p{font-size:14px;line-height:1.7;color:#444;margin:0 0 16px}
    .body strong{color:#1a1a18}
    .btn-wrap{text-align:center;margin:28px 0}
    .btn{background:#1a1a18;color:#fff !important;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:700;display:inline-block}
    .btn:hover{background:#c8963c}
    .doc-list{background:#f8f8f8;border-radius:8px;padding:16px 20px;margin:16px 0}
    .doc-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #eee;font-size:13px}
    .doc-row:last-child{border-bottom:none}
    .doc-badge{background:#1a1a18;color:#c8963c;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;text-transform:uppercase;white-space:nowrap}
    .info-box{background:#fff8ee;border:1px solid #f0d888;border-radius:8px;padding:14px 18px;margin:16px 0;font-size:13px;color:#7a5c00;line-height:1.6}
    .footer{background:#f8f8f8;border-top:1px solid #eee;padding:24px 32px;text-align:center}
    .footer p{font-size:11px;color:#aaa;margin:0;line-height:1.8}
    .footer a{color:#c8963c;text-decoration:none}
  `;

  let subject, html;
  const firstName = (name||'').split(' ')[0] || 'there';

  if (type === 'portal_invite') {
    subject = `Your ${FIRM} Client Portal — Create Your Account`;
    html = `<!DOCTYPE html><html><head><style>${baseStyle}</style></head><body>
    <div class="wrap">
      <div class="band"></div>
      <div class="header">
        <img src="${LOGO_URL}" alt="${FIRM}">
        <div class="header-contact"><a href="tel:${TEL.replace(/ /g,'')}">📞 ${TEL}</a><br><a href="mailto:${REPLY}">${REPLY}</a></div>
      </div>
      <div class="hero">
        <h1>Your Client Portal is Ready</h1>
        <p>${FIRM} — Secure Online Access</p>
      </div>
      <div class="body">
        <p>Dear <strong>${name}</strong>,</p>
        <p>We are pleased to invite you to access your dedicated client portal with <strong>${FIRM}</strong>.</p>
        <p>Your portal gives you secure, 24/7 access to:</p>
        <ul style="font-size:14px;line-height:1.8;color:#444;margin:0 0 16px;padding-left:20px">
          <li>All your documents and tax returns</li>
          <li>Documents awaiting your approval and signature</li>
          <li>Your company details held on file</li>
          <li>Secure correspondence from our team</li>
        </ul>
        <div class="btn-wrap">
          <a href="${link}" class="btn">🏢 Create Your Account →</a>
        </div>
        <div class="info-box">
          Register using your email address: <strong>${to}</strong><br>
          If you need any help, call us on <strong>${TEL}</strong>.
        </div>
        <p>Yours sincerely,<br><strong>Md Asadul Islam Chowdury</strong><br>${FIRM}</p>
      </div>
      <div class="footer">
        <p>${FIRM} &bull; ${ADDR}<br>
        AAT Licensed Accountants &bull; <a href="https://www.chowduryaccountants.co.uk">www.chowduryaccountants.co.uk</a></p>
      </div>
    </div>
    </body></html>`;

  } else if (type === 'document_approval') {
    const docList = (documents||[]).map(d =>
      `<div class="doc-row"><span class="doc-badge">${d.type}</span><span>${d.filename||d.type}</span></div>`
    ).join('');
    subject = `Action Required: Documents Ready for Your Approval — ${company}`;
    html = `<!DOCTYPE html><html><head><style>${baseStyle}</style></head><body>
    <div class="wrap">
      <div class="band"></div>
      <div class="header">
        <img src="${LOGO_URL}" alt="${FIRM}">
        <div class="header-contact"><a href="tel:${TEL.replace(/ /g,'')}">📞 ${TEL}</a><br><a href="mailto:${REPLY}">${REPLY}</a></div>
      </div>
      <div class="hero">
        <h1>Documents Ready for Approval</h1>
        <p>${company}${period?' — Period ended '+period:''}</p>
      </div>
      <div class="body">
        <p>Dear <strong>${name}</strong>,</p>
        <p>Your documents have been prepared and are ready for your review and digital approval.</p>
        ${docList ? `<div class="doc-list">${docList}</div>` : ''}
        <div class="btn-wrap">
          <a href="${link}" class="btn">📄 Review &amp; Approve Documents →</a>
        </div>
        <div class="info-box">
          This link is unique to you and expires in <strong>30 days</strong>. Once approved, a full audit record will be created for your files.<br><br>
          If you have any questions, call us on <strong>${TEL}</strong>.
        </div>
        <p>Yours sincerely,<br><strong>Md Asadul Islam Chowdury</strong><br>${FIRM}</p>
      </div>
      <div class="footer">
        <p>${FIRM} &bull; ${ADDR}<br>
        AAT Licensed Accountants &bull; <a href="https://www.chowduryaccountants.co.uk">www.chowduryaccountants.co.uk</a></p>
      </div>
    </div>
    </body></html>`;

  } else if (type === 'approval_reminder') {
    subject = `Reminder: Documents Awaiting Your Approval — ${company}`;
    html = `<!DOCTYPE html><html><head><style>${baseStyle}</style></head><body>
    <div class="wrap">
      <div class="band"></div>
      <div class="header">
        <img src="${LOGO_URL}" alt="${FIRM}">
        <div class="header-contact"><a href="tel:${TEL.replace(/ /g,'')}">📞 ${TEL}</a><br><a href="mailto:${REPLY}">${REPLY}</a></div>
      </div>
      <div class="hero">
        <h1>Friendly Reminder</h1>
        <p>Documents are awaiting your approval</p>
      </div>
      <div class="body">
        <p>Dear <strong>${name}</strong>,</p>
        <p>Just a friendly reminder that documents for <strong>${company}</strong> are still awaiting your approval.</p>
        <div class="btn-wrap">
          <a href="${link}" class="btn">📄 Review &amp; Approve Now →</a>
        </div>
        <p>If you have already approved these documents, please ignore this message.</p>
        <p>Yours sincerely,<br><strong>Md Asadul Islam Chowdury</strong><br>${FIRM}</p>
      </div>
      <div class="footer">
        <p>${FIRM} &bull; ${ADDR}<br>
        AAT Licensed Accountants &bull; <a href="https://www.chowduryaccountants.co.uk">www.chowduryaccountants.co.uk</a></p>
      </div>
    </div>
    </body></html>`;

  } else {
    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown email type' }) };
  }

  // ── SEND VIA RESEND ──────────────────────────────────
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + RESEND_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        reply_to: REPLY,
        subject,
        html
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Resend error');
    return { statusCode: 200, body: JSON.stringify({ success: true, id: data.id }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
