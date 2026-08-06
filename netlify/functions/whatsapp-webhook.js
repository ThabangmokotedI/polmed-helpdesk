// netlify/functions/whatsapp-webhook.js
// Receives inbound WhatsApp messages via Meta Cloud API and creates tickets in Firestore

const admin = require('firebase-admin');

const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
const projectId   = process.env.FIREBASE_PROJECT_ID;

// Initialise Firebase Admin SDK once
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

exports.handler = async function (event) {
  // ── Webhook verification (GET from Meta) ────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const p = event.queryStringParameters || {};
    if (p['hub.mode'] === 'subscribe' && p['hub.verify_token'] === verifyToken) {
      return { statusCode: 200, body: p['hub.challenge'] || '' };
    }
    return { statusCode: 403, body: 'Verification failed' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // ── Parse inbound message ───────────────────────────────────────────────────
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const change  = body?.entry?.[0]?.changes?.[0];
  const message = change?.value?.messages?.[0];

  // Ignore non-message events (status updates, etc.)
  if (!message) return { statusCode: 200, body: 'Not a message event' };

  const text   = message?.text?.body || message?.caption || '[Media or unsupported message type]';
  const sender = message?.from || 'unknown';
  const now    = new Date();

  const ds       = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
  const ts       = `${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
  const ticketId = `TKT-${ds}-WA-${ts}`;

  const ticket = {
    ticketId,
    contactMethod: 'WhatsApp',
    source:        'whatsapp-webhook',
    status:        'New',
    message:       text,
    phoneNumber:   sender,        // stored for internal reference; not shown in UI
    description:   '',            // agent fills this in during triage
    issueType:     '',            // agent fills this in during triage
    dateReceived:  now.toISOString().split('T')[0],
    timeReceived:  now.toTimeString().split(' ')[0],
    createdBy:     'WhatsApp webhook',
    createdAt:     admin.firestore.FieldValue.serverTimestamp(),
    updatedBy:     'WhatsApp webhook',
    updatedAt:     admin.firestore.FieldValue.serverTimestamp()
  };

  try {
    const db = admin.firestore();
    await db.collection('tickets').add(ticket);
    console.log('Ticket created:', ticketId, 'from sender:', sender.slice(-4)); // log last 4 digits only
    return { statusCode: 200, body: JSON.stringify({ ok: true, ticketId }) };
  } catch (err) {
    console.error('Firestore error:', err.message);
    return { statusCode: 500, body: 'Error creating ticket: ' + err.message };
  }
};
