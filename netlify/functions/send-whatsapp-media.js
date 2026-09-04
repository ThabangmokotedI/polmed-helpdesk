// netlify/functions/send-whatsapp-media.js
// Lets an agent send an image, video, or document to a member over WhatsApp,
// alongside free-form text replies (send-whatsapp-reply.js) and quoted
// replies/reactions (send-whatsapp-interaction.js).
//
// Flow: agent picks a file in the browser -> base64-encoded and POSTed here
// -> we store a copy in Firebase Storage (so it shows up in the ticket's
// conversation thread the same way member-sent media does) -> we upload the
// same file to Meta's media endpoint to get a media ID -> we send that media
// ID as a message to the member -> we log the outbound entry onto the ticket.

const admin = require('firebase-admin');

const accessToken   = process.env.WHATSAPP_ACCESS_TOKEN;
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
const projectId     = process.env.FIREBASE_PROJECT_ID;
const graphVersion  = 'v21.0';

const MAX_BYTES = 5 * 1024 * 1024; // 5MB — stay comfortably under Netlify's payload limit

if (!admin.apps || !admin.apps.length) {
  const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (serviceAccountRaw && projectId) {
    try {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(serviceAccountRaw)),
        projectId,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`
      });
    } catch (err) {
      console.error('Firebase Admin init error:', err.message);
    }
  } else {
    console.error('Missing FIREBASE_SERVICE_ACCOUNT or FIREBASE_PROJECT_ID env vars');
  }
}

async function verifyAgent(event) {
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) return { ok: false, statusCode: 401, error: 'Missing Authorization header' };

  const idToken = match[1];
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    const db = admin.firestore();
    const agentRef = db.collection('agents').doc(decoded.uid);
    const agentSnap = await agentRef.get();

    if (!agentSnap.exists) {
      await agentRef.set({
        email: decoded.email || null,
        role: 'agent',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }

    return { ok: true, uid: decoded.uid, email: decoded.email };
  } catch (err) {
    console.error('Token verification failed:', err.message);
    return { ok: false, statusCode: 401, error: 'Invalid or expired session. Please sign in again.' };
  }
}

function mediaTypeFromMime(mimeType) {
  if (!mimeType) return 'document';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'document';
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };
  }
  if (!accessToken || !phoneNumberId) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'Server not configured for sending WhatsApp messages.' }) };
  }
  if (!admin.apps || !admin.apps.length) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'Server not configured.' }) };
  }

  const agentCheck = await verifyAgent(event);
  if (!agentCheck.ok) {
    return { statusCode: agentCheck.statusCode, body: JSON.stringify({ ok: false, error: agentCheck.error }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Invalid JSON' }) };
  }

  const { ticketId, phoneNumber, fileBase64, mimeType, fileName, caption } = body || {};
  if (!phoneNumber || !fileBase64 || !mimeType) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'phoneNumber, fileBase64 and mimeType are required' }) };
  }

  const buffer = Buffer.from(fileBase64, 'base64');
  if (buffer.length > MAX_BYTES) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'File too large — please keep attachments under 5MB.' }) };
  }

  const mediaType = mediaTypeFromMime(mimeType);
  const ext = (mimeType.split('/')[1] || 'bin').split(';')[0];
  const safeTicketPart = (ticketId || 'unknown').replace(/[^a-zA-Z0-9-]/g, '');
  const storagePath = `whatsapp-media/outbound-${safeTicketPart}-${Date.now()}.${ext}`;

  try {
    const bucket = admin.storage().bucket();
    await bucket.file(storagePath).save(buffer, { metadata: { contentType: mimeType } });
  } catch (err) {
    console.error('Could not store outbound media:', err.message);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'Could not store attachment.' }) };
  }

  let mediaId;
  try {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('file', new Blob([buffer], { type: mimeType }), fileName || `attachment.${ext}`);

    const uploadRes = await fetch(
      `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/media`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}` },
        body: form
      }
    );
    const uploadJson = await uploadRes.json();
    if (!uploadRes.ok || !uploadJson.id) {
      console.error('Meta media upload failed:', JSON.stringify(uploadJson));
      return { statusCode: 502, body: JSON.stringify({ ok: false, error: 'Could not upload file to WhatsApp.' }) };
    }
    mediaId = uploadJson.id;
  } catch (err) {
    console.error('Meta media upload error:', err.message);
    return { statusCode: 502, body: JSON.stringify({ ok: false, error: 'Could not upload file to WhatsApp.' }) };
  }

  const mediaPayload = { id: mediaId };
  if (caption && (mediaType === 'image' || mediaType === 'video' || mediaType === 'document')) {
    mediaPayload.caption = caption;
  }
  if (mediaType === 'document') {
    mediaPayload.filename = fileName || `attachment.${ext}`;
  }

  let metaResult;
  try {
    const sendRes = await fetch(
      `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: phoneNumber,
          type: mediaType,
          [mediaType]: mediaPayload
        })
      }
    );
    metaResult = await sendRes.json();
    if (!sendRes.ok) {
      console.error('Meta send error:', JSON.stringify(metaResult));
      return { statusCode: 502, body: JSON.stringify({ ok: false, error: metaResult }) };
    }
  } catch (err) {
    console.error('Fetch to Meta failed:', err.message);
    return { statusCode: 502, body: JSON.stringify({ ok: false, error: { error: { message: err.message } } }) };
  }

  try {
    if (ticketId) {
      const db = admin.firestore();
      const snap = await db.collection('tickets').where('ticketId', '==', ticketId).limit(1).get();
      if (!snap.empty) {
        const entry = {
          from: 'agent',
          text: caption || `[${mediaType} sent]`,
          mediaPath: storagePath,
          mediaType,
          at: new Date().toISOString()
        };
        await snap.docs[0].ref.update({
          conversation: admin.firestore.FieldValue.arrayUnion(entry),
          lastReply: caption || `[${mediaType} sent]`,
          lastReplyAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: agentCheck.email || 'agent-reply',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    }
  } catch (err) {
    console.error('Firestore update after send failed:', err.message);
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, metaResult }) };
};