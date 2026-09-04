// netlify/functions/send-whatsapp-interaction.js
// Sends a WhatsApp reaction or a quoted (context) reply to a specific member
// message, and logs the result onto the ticket's conversation thread.
//
// Deliberately kept separate from send-whatsapp-reply.js: that function
// sends free-form text with no restriction on emoji use. This function is
// the ONLY place reactions are sent from, and it enforces a curated emoji
// allowlist server-side — not just in the UI — so the restriction can't be
// bypassed by calling the API directly.
//
// Requires the same env vars as send-whatsapp-reply.js:
//   WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID,
//   FIREBASE_SERVICE_ACCOUNT, FIREBASE_PROJECT_ID

const admin = require('firebase-admin');

const accessToken   = process.env.WHATSAPP_ACCESS_TOKEN;
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
const projectId     = process.env.FIREBASE_PROJECT_ID;
const graphVersion  = 'v21.0';

// Server-side allowlist — the UI only ever shows these six, but this check
// is what actually stops any other emoji from being sent as a reaction,
// even if someone calls this endpoint directly instead of using the UI.
const ALLOWED_REACTION_EMOJIS = ['👍', '🙏', '✅', '❤️', '😊', '🎉'];

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
    
     return { ok: false, statusCode: 401, error: `Invalid or expired session: ${err.message}` }; 
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

  const { ticketId, phoneNumber, targetMessageId, mode, emoji, message } = body || {};

  if (!phoneNumber || !targetMessageId || !mode) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'phoneNumber, targetMessageId and mode are required' }) };
  }
  if (mode !== 'reaction' && mode !== 'reply') {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'mode must be "reaction" or "reply"' }) };
  }
  if (mode === 'reaction' && !ALLOWED_REACTION_EMOJIS.includes(emoji)) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'That emoji is not in the approved reaction set.' }) };
  }
  if (mode === 'reply' && !message) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'message is required for mode "reply"' }) };
  }

  // ── Build the Meta Cloud API payload for the requested mode ────────────────
  const metaPayload = mode === 'reaction'
    ? {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phoneNumber,
        type: 'reaction',
        reaction: { message_id: targetMessageId, emoji }
      }
    : {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phoneNumber,
        type: 'text',
        context: { message_id: targetMessageId },
        text: { body: message }
      };

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
        body: JSON.stringify(metaPayload)
      }
    );
    metaResult = await metaRes.json();
    if (!metaRes.ok) {
      console.error('Meta API error:', JSON.stringify(metaResult));
      return { statusCode: 502, body: JSON.stringify({ ok: false, error: metaResult }) };
    }
  } catch (err) {
    console.error('Fetch to Meta failed:', err.message);
    return { statusCode: 502, body: JSON.stringify({ ok: false, error: { error: { message: err.message } } }) };
  }

  // ── Log onto the ticket's conversation thread (best-effort) ────────────────
  try {
    if (ticketId) {
      const db = admin.firestore();
      const snap = await db.collection('tickets').where('ticketId', '==', ticketId).limit(1).get();
      if (!snap.empty) {
        const entry = mode === 'reaction'
          ? {
              from: 'agent',
              text: `Reacted ${emoji} to a member message`,
              isReaction: true,
              mediaPath: null,
              mediaType: null,
              at: new Date().toISOString()
            }
          : {
              from: 'agent',
              text: message,
              repliedToMessageId: targetMessageId,
              mediaPath: null,
              mediaType: null,
              at: new Date().toISOString()
            };
        await snap.docs[0].ref.update({
          conversation: admin.firestore.FieldValue.arrayUnion(entry),
          lastReply: mode === 'reply' ? message : `Reacted ${emoji}`,
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