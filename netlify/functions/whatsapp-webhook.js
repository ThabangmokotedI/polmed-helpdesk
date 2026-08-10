// netlify/functions/whatsapp-webhook.js
// Receives inbound WhatsApp messages via Meta Cloud API and creates tickets in Firestore.
// Media messages (images, documents, etc.) are downloaded from Meta and stored in Firebase Storage.
//
// UPDATED: if the sender already has an open (non-Resolved, non-Unresolved) ticket,
// the new message is appended to that ticket's conversation thread instead of
// creating a brand new ticket. This stops a normal back-and-forth WhatsApp
// conversation from spawning a fresh ticket for every message.
//
// SECURITY FIX (priority #2): every inbound POST is now verified against
// Meta's X-Hub-Signature-256 header before anything else happens. Without
// this, anyone who found this Netlify URL could POST a fake, Meta-shaped
// payload and create real tickets / inject fake "member" messages into
// open tickets, indistinguishable from genuine WhatsApp traffic.

const admin   = require('firebase-admin');
const crypto  = require('crypto');

const verifyToken  = process.env.WHATSAPP_VERIFY_TOKEN;
const appSecret    = process.env.META_APP_SECRET;          // ← NEW: used to verify POST signatures
const projectId    = process.env.FIREBASE_PROJECT_ID;
const accessToken  = process.env.WHATSAPP_ACCESS_TOKEN; // same permanent token used for sending
const graphVersion = 'v21.0';

// Statuses that count as "still open" — a new message from the same number
// gets threaded onto the most recent ticket in one of these statuses.
const OPEN_STATUSES = ['New', 'In Progress'];

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

// ── Webhook signature verification ───────────────────────────────────────────
// Meta signs every POST body with your App Secret. We recompute the same
// HMAC-SHA256 over the exact raw body we received and compare it to the
// x-hub-signature-256 header using a timing-safe comparison (a plain ===
// or string comparison would leak timing information an attacker could use
// to guess the correct signature one byte at a time).
function isValidSignature(rawBody, signatureHeader) {
  if (!appSecret) {
    console.error('META_APP_SECRET not set — rejecting webhook POST (cannot verify signature)');
    return false;
  }
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }
  const expectedSignature =
    'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');

  const receivedBuffer = Buffer.from(signatureHeader);
  const expectedBuffer = Buffer.from(expectedSignature);

  // Buffers must be equal length for timingSafeEqual — different lengths
  // means it's already invalid, and comparing would throw.
  if (receivedBuffer.length !== expectedBuffer.length) return false;

  return crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

// ── Media handling ────────────────────────────────────────────────────────────
const MEDIA_TYPES = ['image', 'video', 'audio', 'document', 'sticker'];

async function fetchAndStoreMedia(mediaId, mimeType, ticketId) {
  if (!accessToken) throw new Error('WHATSAPP_ACCESS_TOKEN not set — cannot fetch media');

  const metaRes = await fetch(
    `https://graph.facebook.com/${graphVersion}/${mediaId}`,
    { headers: { 'Authorization': `Bearer ${accessToken}` } }
  );
  const metaJson = await metaRes.json();
  if (!metaRes.ok || !metaJson.url) {
    throw new Error('Could not get media URL: ' + JSON.stringify(metaJson));
  }

  const fileRes = await fetch(metaJson.url, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  if (!fileRes.ok) throw new Error('Could not download media file, status ' + fileRes.status);
  const buffer = Buffer.from(await fileRes.arrayBuffer());

  const ext      = (mimeType || metaJson.mime_type || '').split('/')[1]?.split(';')[0] || 'bin';
  const filePath = `whatsapp-media/${ticketId}.${ext}`;
  const bucket   = admin.storage().bucket();
  const file     = bucket.file(filePath);
  await file.save(buffer, { metadata: { contentType: mimeType || metaJson.mime_type } });

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

  // ── Verify this POST really came from Meta before touching anything else ───
  // Netlify may base64-encode the body depending on how the request came in,
  // so we normalise to the exact raw text Meta signed before hashing it.
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');

  const signatureHeader =
    event.headers?.['x-hub-signature-256'] || event.headers?.['X-Hub-Signature-256'];

  if (!isValidSignature(rawBody, signatureHeader)) {
    console.error('Rejected webhook POST — missing or invalid X-Hub-Signature-256');
    return { statusCode: 401, body: 'Invalid signature' };
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const change  = body?.entry?.[0]?.changes?.[0];
  const message = change?.value?.messages?.[0];

  if (!message) return { statusCode: 200, body: 'Not a message event' };

  const sender = message?.from || 'unknown';
  const now    = new Date();

  // ── Figure out message content (text vs media) ──────────────────────────────
  let text     = message?.text?.body || '';
  let mediaUrl = null;
  let mediaType = null;

  const ds = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
  const ts = `${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
  const tempIdForMedia = `TMP-${ds}-${ts}`; // only used as a storage path if this turns out to be a new ticket

  if (MEDIA_TYPES.includes(message.type)) {
    const mediaObj = message[message.type];
    mediaType = message.type;
    text      = mediaObj?.caption || `[${message.type} attached]`;
    try {
      mediaUrl = await fetchAndStoreMedia(mediaObj.id, mediaObj.mime_type, tempIdForMedia);
    } catch (err) {
      console.error('Media fetch/store failed:', err.message);
      text = `[${message.type} attached — could not be retrieved, ask member to resend]`;
    }
  } else if (message.type === 'reaction') {
    // Member tapped an emoji reaction on a previous message (e.g. 👍 on your reply).
    // message.reaction.emoji is '' if they removed a reaction rather than added one.
    const emoji = message.reaction?.emoji;
    text = emoji ? `Reacted ${emoji} to a previous message` : 'Removed their reaction to a previous message';
  } else if (message.type === 'location') {
    const loc = message.location;
    text = loc?.name
      ? `[Location shared: ${loc.name}]`
      : `[Location shared: ${loc?.latitude}, ${loc?.longitude}]`;
  } else if (message.type === 'contacts') {
    const names = (message.contacts || []).map(c => c.name?.formatted_name).filter(Boolean).join(', ');
    text = names ? `[Contact card shared: ${names}]` : '[Contact card shared]';
  } else if (!text) {
    text = `[Unsupported message type: ${message.type || 'unknown'}]`;
  }

  try {
    const db = admin.firestore();

    // ── Look for an existing OPEN ticket from this same sender ────────────────
    const existingSnap = await db.collection('tickets')
      .where('phoneNumber', '==', sender)
      .where('status', 'in', OPEN_STATUSES)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();

    if (!existingSnap.empty) {
      // ── Thread the new message onto the existing ticket ─────────────────────
      const ticketDoc = existingSnap.docs[0];
      const ticketData = ticketDoc.data();

      const newEntry = {
        from: 'member',
        text,
        mediaUrl,
        mediaType,
        at: now.toISOString()
      };

      await ticketDoc.ref.update({
        conversation: admin.firestore.FieldValue.arrayUnion(newEntry),
        lastMemberMessage: text,
        lastMemberMessageAt: admin.firestore.FieldValue.serverTimestamp(),
        hasNewReply: true,
        updatedBy: 'WhatsApp webhook',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log('Appended to existing ticket:', ticketData.ticketId, 'from sender:', sender.slice(-4));
      return { statusCode: 200, body: JSON.stringify({ ok: true, ticketId: ticketData.ticketId, appended: true }) };
    }

    // ── No open ticket found — create a new one ────────────────────────────────
    const ticketId = `TKT-${ds}-WA-${ts}`;

    // If this message had media, move it from the temp path to the real ticket ID path
    let finalMediaUrl = mediaUrl;
    if (mediaUrl) {
      try {
        const bucket = admin.storage().bucket();
        const ext = mediaUrl.split('.').pop().split('?')[0];
        const oldFile = bucket.file(`whatsapp-media/${tempIdForMedia}.${ext}`);
        const newFile = bucket.file(`whatsapp-media/${ticketId}.${ext}`);
        await oldFile.move(newFile);
        const [url] = await newFile.getSignedUrl({ action: 'read', expires: '01-01-2100' });
        finalMediaUrl = url;
      } catch (err) {
        console.error('Could not rename media file to final ticket ID:', err.message);
        // fall back to the temp URL — not fatal
      }
    }

    const ticket = {
      ticketId,
      contactMethod: 'WhatsApp',
      source:        'whatsapp-webhook',
      status:        'New',
      message:       text,
      mediaUrl:      finalMediaUrl,
      mediaType,
      phoneNumber:   sender,
      description:   '',
      issueType:     '',
      conversation:  [{ from: 'member', text, mediaUrl: finalMediaUrl, mediaType, at: now.toISOString() }],
      dateReceived:  now.toISOString().split('T')[0],
      timeReceived:  now.toTimeString().split(' ')[0],
      createdBy:     'WhatsApp webhook',
      createdAt:     admin.firestore.FieldValue.serverTimestamp(),
      updatedBy:     'WhatsApp webhook',
      updatedAt:     admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection('tickets').add(ticket);
    console.log('New ticket created:', ticketId, 'from sender:', sender.slice(-4), mediaType ? `(media: ${mediaType})` : '');
    return { statusCode: 200, body: JSON.stringify({ ok: true, ticketId }) };

  } catch (err) {
    console.error('Firestore error:', err.message);
    return { statusCode: 500, body: 'Error creating/updating ticket: ' + err.message };
  }
};