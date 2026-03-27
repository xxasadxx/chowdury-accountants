// Netlify Function: sign-pdf.js
// Appends a branded signature/audit page to the approved PDF
// Called from approve.html after client signs

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

const SB_URL = 'https://yhvhpfsoqtjwnukgyqap.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlodmhwZnNvcXRqd251a2d5cWFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1MzUzODQsImV4cCI6MjA4ODExMTM4NH0.QDTVLU0vNRc3WJfYTOOG3ct9G2Ywgd49dC5hr6to3P4';
const H = { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' };

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const { token } = body;
  if (!token) return { statusCode: 400, body: 'Missing token' };

  try {
    // 1. Fetch approval record
    const res = await fetch(`${SB_URL}/rest/v1/client_approvals?token=eq.${token}&select=*`, { headers: H });
    const records = await res.json();
    if (!records || !records.length) return { statusCode: 404, body: 'Approval not found' };
    const approval = records[0];

    if (approval.status !== 'approved') return { statusCode: 400, body: 'Not yet approved' };
    if (approval.signed_pdf_path) return { statusCode: 200, body: JSON.stringify({ path: approval.signed_pdf_path, already_done: true }) };

    const docs = approval.documents || [];
    const signedPaths = [];

    // 2. Process each document — append signature page
    for (const doc of docs) {
      if (!doc.storage_path) continue;

      // Get signed URL for original PDF
      const urlRes = await fetch(`${SB_URL}/storage/v1/object/sign/client-documents/${doc.storage_path}`, {
        method: 'POST',
        headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: 300 })
      });
      const urlData = await urlRes.json();
      const signedUrl = urlData.signedURL || urlData.signedUrl;
      if (!signedUrl) continue;

      // Download original PDF
      let pdfBytes;
      try {
        const fullUrl = signedUrl.startsWith('http') ? signedUrl : `${SB_URL}/storage/v1${signedUrl}`;
        console.log('Downloading PDF:', fullUrl.substring(0, 100));
        const dlRes = await fetch(fullUrl);
        if (!dlRes.ok) throw new Error('Download failed: ' + dlRes.status);
        pdfBytes = await dlRes.arrayBuffer();
        console.log('PDF downloaded, bytes:', pdfBytes.byteLength);
      } catch(e) {
        console.error('PDF download error:', e.message);
        continue;
      }

      // Load PDF and append signature page
      // Load PDF and append signature page
      let pdfDoc;
      try {
        console.log('Loading PDF with pdf-lib...');
        pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        console.log('PDF loaded, pages:', pdfDoc.getPageCount());
      } catch(pdfErr) {
        console.error('pdf-lib load error:', pdfErr.message);
        continue;
      }
      const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

      // Add new page at end
      const sigPage = pdfDoc.addPage([595, 842]); // A4
      const { width, height } = sigPage.getSize();

      // Colours
      const dark = rgb(0.102, 0.102, 0.094);   // #1a1a18
      const gold = rgb(0.784, 0.588, 0.235);    // #c8963c
      const green = rgb(0.082, 0.541, 0.082);   // #158c15
      const lightGrey = rgb(0.95, 0.95, 0.95);
      const midGrey = rgb(0.6, 0.6, 0.6);
      const white = rgb(1, 1, 1);

      // Header band (gold)
      sigPage.drawRectangle({ x: 0, y: height - 6, width, height: 6, color: gold });

      // Dark header bar
      sigPage.drawRectangle({ x: 0, y: height - 70, width, height: 64, color: dark });

      // Header text
      sigPage.drawText('CHOWDURY ACCOUNTANTS', {
        x: 30, y: height - 35, size: 14, font: helveticaBold, color: gold
      });
      sigPage.drawText('The Chowdury Accountants Ltd  •  Company Reg: 09441520  •  283 Featherstall Road North, Oldham, OL1 2NH', {
        x: 30, y: height - 55, size: 7, font: helvetica, color: rgb(0.7, 0.7, 0.7)
      });

      // Document approval section
      let y = height - 100;

      // Green approval banner
      sigPage.drawRectangle({ x: 30, y: y - 10, width: width - 60, height: 36, color: rgb(0.91, 0.965, 0.91) });
      sigPage.drawRectangle({ x: 30, y: y - 10, width: 4, height: 36, color: green });
      sigPage.drawText('DOCUMENT DIGITALLY APPROVED', {
        x: 44, y: y + 10, size: 11, font: helveticaBold, color: green
      });
      sigPage.drawText('This document has been digitally signed and approved. Full audit trail below.', {
        x: 44, y: y - 2, size: 8, font: helvetica, color: green
      });

      y -= 40;

      // Approval details table
      const tableData = [
        ['Company', approval.company_name || '—'],
        ['Document', doc.filename || doc.type],
        ['Document Type', doc.type || '—'],
        ['Period End', approval.period_end || '—'],
        ['Prepared By', approval.created_by || 'Chowdury Accountants'],
      ];

      // Section title
      y -= 20;
      sigPage.drawText('APPROVAL DETAILS', {
        x: 30, y, size: 8, font: helveticaBold, color: midGrey
      });
      y -= 4;
      sigPage.drawLine({ start: { x: 30, y }, end: { x: width - 30, y }, thickness: 0.5, color: lightGrey });

      for (const [label, value] of tableData) {
        y -= 20;
        sigPage.drawRectangle({ x: 30, y: y - 4, width: 140, height: 18, color: lightGrey });
        sigPage.drawText(label, { x: 36, y: y + 1, size: 8, font: helveticaBold, color: dark });
        sigPage.drawText(String(value).substring(0, 70), { x: 178, y: y + 1, size: 8, font: helvetica, color: dark });
        sigPage.drawLine({ start: { x: 30, y: y - 4 }, end: { x: width - 30, y: y - 4 }, thickness: 0.3, color: lightGrey });
      }

      // Signature section
      y -= 40;
      sigPage.drawText('DIGITAL SIGNATURE & AUDIT TRAIL', {
        x: 30, y, size: 8, font: helveticaBold, color: midGrey
      });
      y -= 4;
      sigPage.drawLine({ start: { x: 30, y }, end: { x: width - 30, y }, thickness: 0.5, color: lightGrey });

      const signedAt = approval.approved_at
        ? new Date(approval.approved_at).toLocaleString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : '—';

      const sigData = [
        ['Signed By', approval.approved_name || '—'],
        ['Date & Time', signedAt],
        ['IP Address', approval.approved_ip || '—'],
        ['Declaration', approval.declaration_confirmed ? 'Confirmed — I have reviewed and approve this document' : 'Not confirmed'],
        ['Email', approval.client_email || '—'],
        ['Reference', 'CA-APR-' + token.substring(0, 8).toUpperCase()],
      ];

      for (const [label, value] of sigData) {
        y -= 20;
        sigPage.drawRectangle({ x: 30, y: y - 4, width: 140, height: 18, color: lightGrey });
        sigPage.drawText(label, { x: 36, y: y + 1, size: 8, font: helveticaBold, color: dark });
        sigPage.drawText(String(value).substring(0, 80), { x: 178, y: y + 1, size: 8, font: helvetica, color: dark });
        sigPage.drawLine({ start: { x: 30, y: y - 4 }, end: { x: width - 30, y: y - 4 }, thickness: 0.3, color: lightGrey });
      }

      // Printed signature in cursive-style
      y -= 50;
      sigPage.drawRectangle({ x: 30, y: y - 15, width: 260, height: 50, color: lightGrey });
      sigPage.drawText('Signed:', { x: 36, y: y + 22, size: 7, font: helvetica, color: midGrey });
      // Large name as "signature"
      const sigName = (approval.approved_name || '').substring(0, 30);
      sigPage.drawText(sigName, { x: 36, y: y, size: 20, font: helveticaBold, color: dark });
      sigPage.drawLine({ start: { x: 36, y: y - 8 }, end: { x: 280, y: y - 8 }, thickness: 0.5, color: midGrey });

      // User agent (small)
      y -= 40;
      const ua = (approval.approved_user_agent || '').substring(0, 90);
      sigPage.drawText('Browser: ' + ua, { x: 30, y, size: 6, font: helvetica, color: midGrey });

      // Footer
      y = 40;
      sigPage.drawLine({ start: { x: 30, y: y + 15 }, end: { x: width - 30, y: y + 15 }, thickness: 0.3, color: lightGrey });
      sigPage.drawText('This signed document was generated by the Chowdury Accountants Client Portal. AAT Licensed Accountants.', {
        x: 30, y: y + 4, size: 6.5, font: helvetica, color: midGrey
      });
      sigPage.drawText('Powered by Chowdury Accountants Portal  •  www.chowduryaccountants.co.uk  •  Tel: 0161 222 4647', {
        x: 30, y, size: 6.5, font: helvetica, color: midGrey
      });

      // Save signed PDF
      const signedBytes = await pdfDoc.save();

      // Upload to Supabase storage
      const signedPath = doc.storage_path.replace(/(\.[^.]+)$/, '_SIGNED$1');
      const uploadRes = await fetch(`${SB_URL}/storage/v1/object/client-documents/${signedPath}`, {
        method: 'POST',
        headers: {
          'apikey': SB_KEY,
          'Authorization': 'Bearer ' + SB_KEY,
          'Content-Type': 'application/pdf',
          'x-upsert': 'true'
        },
        body: signedBytes
      });
      console.log('Upload status:', uploadRes.status, 'path:', signedPath);
      if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        console.error('Upload failed:', errText);
      } else {
        signedPaths.push({ original: doc.storage_path, signed: signedPath, type: doc.type });
      }

    }
    // 3. Update record with signed PDF paths
    if (signedPaths.length > 0) {
      await fetch(`${SB_URL}/rest/v1/client_approvals?token=eq.${token}`, {
        method: 'PATCH',
        headers: H,
        body: JSON.stringify({ signed_pdf_path: signedPaths[0].signed, signed_documents: signedPaths })
      });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, signed: signedPaths })
    };

  } catch (e) {
    console.error('sign-pdf error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
