// netlify/functions/send-whatsapp-reply.js
// Sends a free-form WhatsApp reply to a member via Meta Cloud API, and logs
// the reply onto the ticket in Firestore.
//
// Requires these env vars in Netlify (same project as whatsapp-webhook.js):
//   WHATSAPP_ACCESS_TOKEN     — permanent System User token (see note below)
//   WHATSAPP_PHONE_NUMBER_ID  — the Phone Number ID for YOUR business number
//                                 (Meta → WhatsApp → API Setup — this is
//                                 different from the phone number itself,
//                                 it's a long numeric ID next to it)
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

  // ── Log the reply on the ticket in Firestore (best-effort, non-fatal) ───────
  try {
    if (admin.apps.length && ticketId) {
      const db = admin.firestore();
      const snap = await db.collection('tickets').where('ticketId', '==', ticketId).limit(1).get();
      if (!snap.empty) {
        await snap.docs[0].ref.update({
          lastReply: message,
          lastReplyAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: 'agent-reply',
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