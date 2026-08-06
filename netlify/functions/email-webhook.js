// netlify/functions/email-webhook.js
// Receives inbound emails via Mailgun Routes and creates tickets in Firestore
// Works with: Mailgun Inbound Routes (free plan)

const admin  = require('firebase-admin');
const crypto = require('crypto');

const projectId        = process.env.FIREBASE_PROJECT_ID;
const mailgunSigningKey = process.env.MAILGUN_SIGNING_KEY || '';

// Initialise Firebase Admin SDK once (shared with whatsapp-webhook if warm)
if (!admin.apps.length) {
  const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccountRaw || !projectId) {
    console.error('Missing FIREBASE_SERVICE_ACCOUNT or FIREBASE_PROJECT_ID env vars');
  } else {
    try {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(serviceAccountRaw)),
        projectId
      });
    } catch (err) {
      console.error('Firebase Admin init error:', err.message);
    }
  }
}

// ── Mailgun signature verification ───────────────────────────────────────────
function verifyMailgunSignature(params) {
  if (!mailgunSigningKey) return true; // Skip if key not set (dev/test)
  const { timestamp, token, signature } = params;
  if (!timestamp || !token || !signature) return false;
  const value = timestamp + token;
  const hash  = crypto.createHmac('sha256', mailgunSigningKey).update(value).digest('hex');
  return hash === signature;
}

// ── Parse multipart/form-data (Mailgun sends this) ───────────────────────────
function parseFormData(body, contentType) {
  const fields = {};
  try {
    // Netlify decodes base64 body for binary; Mailgun sends form-encoded or multipart
    // Try URL-encoded first
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const pairs = body.split('&');
      for (const pair of pairs) {
        const [k, v] = pair.split('=').map(s => decodeURIComponent(s.replace(/\+/g, ' ')));
        if (k) fields[k] = v || '';
      }
      return fields;
    }
    // Multipart boundary
    const boundary = (contentType.match(/boundary=([^\s;]+)/) || [])[1];
    if (!boundary) return fields;
    const parts = body.split('--' + boundary);
    for (const part of parts) {
      const match = part.match(/Content-Disposition: form-data; name="([^"]+)"[\r\n]+([\s\S]*?)[\r\n]*$/);
      if (match) fields[match[1]] = match[2].trim();
    }
  } catch (e) {
    console.warn('Form parse error:', e.message);
  }
  return fields;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const contentType = (event.headers['content-type'] || '').toLowerCase();
  const rawBody     = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf-8')
    : (event.body || '');

  const fields = parseFormData(rawBody, contentType);

  // Verify Mailgun signature
  if (mailgunSigningKey && !verifyMailgunSignature(fields)) {
    console.warn('Invalid Mailgun signature — rejecting request');
    return { statusCode: 403, body: 'Invalid signature' };
  }

  // Extract email fields (Mailgun naming)
  const fromRaw   = fields['from']        || fields['From']        || 'unknown@unknown.com';
  const subject   = fields['subject']     || fields['Subject']     || '(No subject)';
  const bodyText  = fields['body-plain']  || fields['stripped-text'] || fields['text'] || '';
  const recipient = fields['recipient']   || fields['To']           || '';

  // Sanitise: extract just the email address from "Name <email@>" format
  const fromEmail = (fromRaw.match(/<([^>]+)>/) || [, fromRaw])[1].trim();

  const now    = new Date();
  const ds     = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
  const ts     = `${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
  const ticketId = `TKT-${ds}-EM-${ts}`;

  // Truncate body to 2000 chars
  const messageBody = bodyText.trim().slice(0, 2000);

  const ticket = {
    ticketId,
    contactMethod: 'Email',
    source:        'email-webhook',
    status:        'New',
    message:       `Subject: ${subject}\n\n${messageBody}`,
    description:   subject,     // subject as initial description; agent can update
    issueType:     '',          // agent fills in during triage
    identifier:    '',          // agent fills in member number during triage
    fromEmail,                  // stored for reference (internal use only — POPIA)
    recipient,
    dateReceived:  now.toISOString().split('T')[0],
    timeReceived:  now.toTimeString().split(' ')[0],
    createdBy:     'Email webhook',
    createdAt:     admin.firestore.FieldValue.serverTimestamp(),
    updatedBy:     'Email webhook',
    updatedAt:     admin.firestore.FieldValue.serverTimestamp()
  };

  try {
    const db = admin.firestore();
    await db.collection('tickets').add(ticket);
    console.log('Email ticket created:', ticketId, 'from:', fromEmail);
    return { statusCode: 200, body: JSON.stringify({ ok: true, ticketId }) };
  } catch (err) {
    console.error('Firestore error:', err.message);
    return { statusCode: 500, body: 'Error creating ticket: ' + err.message };
  }
};
