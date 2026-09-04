// netlify/functions/send-whatsapp-reply.js
// Sends a free-form WhatsApp reply to a member via Meta Cloud API, and logs
// the reply onto the ticket's conversation thread in Firestore.
//
// Requires these env vars in Netlify (same project as whatsapp-webhook.js):
//   WHATSAPP_ACCESS_TOKEN     — permanent System User token
//   WHATSAPP_PHONE_NUMBER_ID  — the Phone Number ID for YOUR business number
//   FIREBASE_SERVICE_ACCOUNT  — already set
//   FIREBASE_PROJECT_ID       — already set

const admin = require('firebase-admin');

const accessToken   = process.env.WHATSAPP_ACCESS_TOKEN;
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
const projectId     = process.env.FIREBASE_PROJECT_ID;
const graphVersion  = 'v21.0';

if (!admin.apps.length) {
  const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (serviceAccountRaw && projectId) {
    try {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(serviceAccountRaw)),
        projectId
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
    const agentSnap = await admin.firestore().collection('agents').doc(decoded.uid).get();
    if (!agentSnap.exists) return { ok: false, statusCode: 403, error: 'No agent record for this account' };
    return { ok: true, uid: decoded.uid, email: decoded.email };
  } catch (err) {
    console.error('Token verification failed:', err.message);
    return { ok: false, statusCode: 401, error: 'Invalid or expired session. Please sign in again.' };
  }
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };
  }

  if (!accessToken || !phoneNumberId) {
    console.error('Missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID env vars');
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: 'Server not configured for sending WhatsApp messages.' })
    };
  }

  if (!admin.apps.length) {
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

  const { ticketId, phoneNumber, message } = body || {};
  if (!phoneNumber || !message) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'phoneNumber and message are required' }) };
  }

  // ── Send the message via Meta Cloud API ─────────────────────────────────────
  let metaResult;
  try {
    const metaRes = await fetch(
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
          type: 'text',
          text: { body: message }
        })
      }
    );
    metaResult = await metaRes.json();

    if (!metaRes.ok) {
      console.error('Meta API error:', JSON.stringify(metaResult));
      return {
        statusCode: 502,
        body: JSON.stringify({ ok: false, error: metaResult })
      };
    }
  } catch (err) {
    console.error('Fetch to Meta failed:', err.message);
    return {
      statusCode: 502,
      body: JSON.stringify({ ok: false, error: { error: { message: err.message } } })
    };
  }

  // ── Log the reply onto the ticket's conversation thread (best-effort) ───────
  try {
    if (admin.apps.length && ticketId) {
      const db = admin.firestore();
      const snap = await db.collection('tickets').where('ticketId', '==', ticketId).limit(1).get();
      if (!snap.empty) {
        const entry = {
          from: 'agent',
          text: message,
          mediaUrl: null,
          mediaType: null,
          at: new Date().toISOString()
        };
        await snap.docs[0].ref.update({
          conversation: admin.firestore.FieldValue.arrayUnion(entry),
          lastReply: message,
          lastReplyAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: agentCheck.email || 'agent-reply',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    }
  } catch (err) {
    // Don't fail the whole request just because the Firestore log failed —
    // the WhatsApp message already sent successfully at this point.
    console.error('Firestore update after send failed:', err.message);
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, metaResult }) };
};