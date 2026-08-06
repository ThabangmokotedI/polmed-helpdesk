// netlify/functions/whatsapp-webhook.js
// Receives inbound WhatsApp messages via Meta Cloud API and creates tickets in Firestore.
// Media messages (images, documents, etc.) are downloaded from Meta and stored in Firebase Storage.

const admin = require('firebase-admin');

const verifyToken  = process.env.WHATSAPP_VERIFY_TOKEN;
const projectId    = process.env.FIREBASE_PROJECT_ID;
const accessToken  = process.env.WHATSAPP_ACCESS_TOKEN; // same permanent token used for sending
const graphVersion = 'v21.0';

// Initialise Firebase Admin SDK once
if (!admin.apps.length) {
  const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccountRaw || !projectId) {
    console.error('Missing FIREBASE_SERVICE_ACCOUNT or FIREBASE_PROJECT_ID env vars');
  } else {
    try {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(serviceAccountRaw)),
        projectId,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`
      });
    } catch (err) {
      console.error('Firebase Admin init error:', err.message);
    }
  }
}

// ── Media handling ────────────────────────────────────────────────────────────
// WhatsApp media message types that carry a downloadable asset
const MEDIA_TYPES = ['image', 'video', 'audio', 'document', 'sticker'];

async function fetchAndStoreMedia(mediaId, mimeType, ticketId) {
  if (!accessToken) throw new Error('WHATSAPP_ACCESS_TOKEN not set — cannot fetch media');

  // Step 1: ask Meta for the temporary download URL
  const metaRes = await fetch(
    `https://graph.facebook.com/${graphVersion}/${mediaId}`,
    { headers: { 'Authorization': `Bearer ${accessToken}` } }
  );
  const metaJson = await metaRes.json();
  if (!metaRes.ok || !metaJson.url) {
    throw new Error('Could not get media URL: ' + JSON.stringify(metaJson));
  }

  // Step 2: download the actual file (also needs the same auth header — expires within minutes)
  const fileRes = await fetch(metaJson.url, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  if (!fileRes.ok) throw new Error('Could not download media file, status ' + fileRes.status);
  const buffer = Buffer.from(await fileRes.arrayBuffer());

  // Step 3: upload to Firebase Storage
  const ext      = (mimeType || metaJson.mime_type || '').split('/')[1]?.split(';')[0] || 'bin';
  const filePath = `whatsapp-media/${ticketId}.${ext}`;
  const bucket   = admin.storage().bucket();
  const file     = bucket.file(filePath);
  await file.save(buffer, { metadata: { contentType: mimeType || metaJson.mime_type } });

  // Step 4: get a long-lived signed URL agents can view in the dashboard
  const [url] = await file.getSignedUrl({ action: 'read', expires: '01-01-2100' });
  return url;
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

  const sender = message?.from || 'unknown';
  const now    = new Date();

  const ds       = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
  const ts       = `${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
  const ticketId = `TKT-${ds}-WA-${ts}`;

  // ── Figure out message content (text vs media) ──────────────────────────────
  let text     = message?.text?.body || '';
  let mediaUrl = null;
  let mediaType = null;

  if (MEDIA_TYPES.includes(message.type)) {
    const mediaObj = message[message.type]; // e.g. message.image, message.document
    mediaType = message.type;
    text      = mediaObj?.caption || `[${message.type} attached]`;
    try {
      mediaUrl = await fetchAndStoreMedia(mediaObj.id, mediaObj.mime_type, ticketId);
    } catch (err) {
      console.error('Media fetch/store failed:', err.message);
      text = `[${message.type} attached — could not be retrieved, ask member to resend]`;
    }
  } else if (!text) {
    text = '[Unsupported message type]';
  }

  const ticket = {
    ticketId,
    contactMethod: 'WhatsApp',
    source:        'whatsapp-webhook',
    status:        'New',
    message:       text,
    mediaUrl,                      // null if no media, or a signed Firebase Storage URL
    mediaType,                     // null, or 'image' | 'video' | 'audio' | 'document' | 'sticker'
    phoneNumber:   sender,
    description:   '',
    issueType:     '',
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
    console.log('Ticket created:', ticketId, 'from sender:', sender.slice(-4), mediaType ? `(media: ${mediaType})` : '');
    return { statusCode: 200, body: JSON.stringify({ ok: true, ticketId }) };
  } catch (err) {
    console.error('Firestore error:', err.message);
    return { statusCode: 500, body: 'Error creating ticket: ' + err.message };
  }
};