// netlify/functions/start-whatsapp-conversation.js
// Starts a proactive WhatsApp conversation from an authenticated dashboard agent.

const admin = require('firebase-admin');

const accessToken   = process.env.WHATSAPP_ACCESS_TOKEN;
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
const projectId     = process.env.FIREBASE_PROJECT_ID;
const graphVersion  = 'v21.0';
const TEMPLATE_NAME = 'REPLACE_WITH_APPROVED_TEMPLATE_NAME';
const HARARE_TIME_ZONE = 'Africa/Harare';

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

function harareDateTimeParts(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: HARARE_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).reduce((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`
  };
}

function json(statusCode, body) {
  return { statusCode, body: JSON.stringify(body) };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });
  if (!accessToken || !phoneNumberId || !admin.apps.length) {
    return json(500, { ok: false, error: 'Server is not configured for WhatsApp or Firebase.' });
  }

  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  if (!authHeader.startsWith('Bearer ')) return json(401, { ok: false, error: 'Authentication required' });
  let agent;
  try {
    agent = await admin.auth().verifyIdToken(authHeader.slice('Bearer '.length));
  } catch {
    return json(401, { ok: false, error: 'Invalid authentication token' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { ok: false, error: 'Invalid JSON' }); }

  const phoneNumber = String(body.phoneNumber || '').trim().replace(/[^0-9]/g, '');
  const memberName = String(body.memberName || '').trim().slice(0, 120);
  const note = String(body.note || '').trim().slice(0, 1000);
  if (!phoneNumber || !note) {
    return json(400, { ok: false, error: 'phoneNumber and note are required' });
  }
  if (TEMPLATE_NAME === 'REPLACE_WITH_APPROVED_TEMPLATE_NAME') {
    return json(500, { ok: false, error: 'Set TEMPLATE_NAME to an approved WhatsApp template name before sending.' });
  }

  const now = new Date();
  const received = harareDateTimeParts(now);
  const ticketId = `TKT-${received.date.replaceAll('-', '')}-AI-${received.time.replaceAll(':', '')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const templateParameters = [
    { type: 'text', text: memberName || 'there' },
    { type: 'text', text: note }
  ];

  try {
    const metaRes = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phoneNumber,
        type: 'template',
        template: {
          name: TEMPLATE_NAME,
          language: { code: 'en_US' },
          components: [{ type: 'body', parameters: templateParameters }]
        }
      })
    });
    const metaResult = await metaRes.json();
    if (!metaRes.ok) {
      console.error('Meta API error:', JSON.stringify(metaResult));
      return json(502, { ok: false, error: metaResult });
    }

    const messageText = memberName ? `Proactive contact with ${memberName}: ${note}` : `Proactive contact: ${note}`;
    const ticket = {
      ticketId,
      contactMethod: 'WhatsApp',
      source: 'agent-initiated',
      origin: 'agent_initiated',
      status: 'In Progress',
      message: messageText,
      mediaPath: null,
      mediaType: null,
      phoneNumber,
      identifier: '',
      description: note,
      issueType: 'Unspecified / No Response',
      conversation: [{
        from: 'agent',
        text: messageText,
        mediaPath: null,
        mediaType: null,
        at: now.toISOString()
      }],
      dateReceived: received.date,
      timeReceived: received.time,
      createdBy: agent.email || agent.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: agent.email || agent.uid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await admin.firestore().collection('tickets').add(ticket);
    return json(200, { ok: true, ticketId, metaResult });
  } catch (err) {
    console.error('Could not start WhatsApp conversation:', err.message);
    return json(500, { ok: false, error: err.message });
  }
};
