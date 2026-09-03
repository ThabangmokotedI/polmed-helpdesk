// netlify/functions/whatsapp-webhook.js
// Receives inbound WhatsApp messages via Meta Cloud API and creates tickets in Firestore.
// Media messages (images, documents, etc.) are downloaded from Meta and stored in Firebase Storage.
//
// SECURITY: every POST from Meta is signed with your Meta App Secret, sent in the
// x-hub-signature-256 header. We verify that signature against the raw request body
// before trusting anything in it.
//
// HEALTH MONITORING: every run writes a heartbeat to system/webhookHealth in Firestore
// (read live by the dashboard banner) and, on a genuine config/processing problem,
// sends an email alert via Mailgun (rate-limited to once per 30 min). A forged/bad
// signature from a random request is NOT treated as a health problem — that's the
// security check working as intended, not a system fault.
//
// Requires:
//   WHATSAPP_VERIFY_TOKEN, WHATSAPP_ACCESS_TOKEN, WHATSAPP_APP_SECRET,
//   FIREBASE_PROJECT_ID, FIREBASE_SERVICE_ACCOUNT (existing)
//   MAILGUN_SIGNING_KEY, MAILGUN_DOMAIN, ALERT_EMAIL_TO (new, for alert emails)

const admin  = require('firebase-admin');
const crypto = require('crypto');

const verifyToken   = process.env.WHATSAPP_VERIFY_TOKEN;
const appSecret     = process.env.WHATSAPP_APP_SECRET;
const projectId     = process.env.FIREBASE_PROJECT_ID;
const accessToken   = process.env.WHATSAPP_ACCESS_TOKEN;
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
const graphVersion  = 'v21.0';

const mailgunApiKey = process.env.MAILGUN_SIGNING_KEY;
const mailgunDomain  = process.env.MAILGUN_DOMAIN;
const alertEmailTo   = process.env.ALERT_EMAIL_TO;
const ALERT_COOLDOWN_MS = 30 * 60 * 1000;

const OPEN_STATUSES = ['New', 'In Progress'];

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

// ── Health heartbeat + alert email ───────────────────────────────────────────
async function recordHealth(status, errorMessage) {
  if (!admin.apps.length) return;
  const db  = admin.firestore();
  const ref = db.collection('system').doc('webhookHealth');
  const now = admin.firestore.FieldValue.serverTimestamp();
  const isProblem = status === 'config_error' || status === 'processing_error';

  const update = { lastRunAt: now, lastStatus: status };
  if (status === 'ok') { update.lastSuccessAt = now; update.consecutiveErrors = 0; }
  if (isProblem) {
    update.lastErrorAt = now;
    update.lastErrorMessage = errorMessage || '';
    update.consecutiveErrors = admin.firestore.FieldValue.increment(1);
  }

  try { await ref.set(update, { merge: true }); }
  catch (err) { console.error('Could not write health heartbeat:', err.message); }

  if (isProblem) await maybeSendAlertEmail(status, errorMessage);
}

async function maybeSendAlertEmail(status, errorMessage) {
  if (!mailgunApiKey || !mailgunDomain || !alertEmailTo) {
    console.error('Alert email not configured (need MAILGUN_SIGNING_KEY, MAILGUN_DOMAIN, ALERT_EMAIL_TO)');
    return;
  }
  const db  = admin.firestore();
  const ref = db.collection('system').doc('webhookHealth');
  try {
    const snap = await ref.get();
    const lastAlertMs = snap.exists ? snap.data().lastAlertSentAt?.toMillis?.() : null;
    if (lastAlertMs && (Date.now() - lastAlertMs) < ALERT_COOLDOWN_MS) return;
    await ref.set({ lastAlertSentAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  } catch (err) {
    console.error('Could not check alert cooldown:', err.message);
    return;
  }

  try {
    const form = new URLSearchParams();
    form.append('from', `POLMED Helpdesk Alerts <alerts@${mailgunDomain}>`);
    form.append('to', alertEmailTo);
    form.append('subject', `⚠ POLMED Helpdesk: WhatsApp webhook issue (${status})`);
    form.append('text',
      `The WhatsApp webhook has reported a problem and may not be creating tickets from member messages.\n\n` +
      `Status: ${status}\nDetails: ${errorMessage || 'No further detail available.'}\nTime: ${new Date().toISOString()}\n\n` +
      `Check the whatsapp-webhook function logs in Netlify.`
    );
    const res = await fetch(`https://api.mailgun.net/v3/${mailgunDomain}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`api:${mailgunApiKey}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: form.toString()
    });
    if (!res.ok) console.error('Mailgun alert send failed:', res.status, await res.text());
    else console.log('Alert email sent for status:', status);
  } catch (err) {
    console.error('Error sending alert email:', err.message);
  }
}

// ── Signature verification ───────────────────────────────────────────────────
function checkSignature(event) {
  if (!appSecret) return { ok: false, reason: 'config_error' };

  const signatureHeader = event.headers?.['x-hub-signature-256'] || event.headers?.['X-Hub-Signature-256'];
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return { ok: false, reason: 'missing_header' };

  const receivedSig = signatureHeader.slice('sha256='.length);
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64')
    : Buffer.from(event.body || '', 'utf8');
  const expectedSig = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');

  const receivedBuf = Buffer.from(receivedSig, 'hex');
  const expectedBuf = Buffer.from(expectedSig, 'hex');
  if (receivedBuf.length !== expectedBuf.length) return { ok: false, reason: 'mismatch' };

  return { ok: crypto.timingSafeEqual(receivedBuf, expectedBuf), reason: 'mismatch' };
}

async function markMessageAsRead(messageId) {
  if (!messageId || !accessToken || !phoneNumberId) return;
  try {
    await fetch(
      `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId })
      }
    );
  } catch (err) {
    console.error('Could not mark message as read:', err.message);
  }
}

// WhatsApp list rows are limited to 24 characters per title, so a couple of
// these are shortened from the full dropdown labels used elsewhere in the
// app. The row "id" always carries the FULL original string, so whatever
// gets stored on the ticket matches the exact values the dashboard's Issue
// Type dropdown and filters expect.
const ISSUE_TYPE_LIST_ROWS = [
  { id: 'Onboarding assistance', title: 'Onboarding assistance' },
  { id: 'Login Issue', title: 'Login Issue' },
  { id: 'Forgot username/password', title: 'Forgot username/pwd' },
  { id: 'Membership & documents', title: 'Membership & documents' },
  { id: 'Wellness tracker', title: 'Wellness tracker' },
  { id: 'Feature malfunction', title: 'Feature malfunction' },
  { id: 'Huawei user', title: 'Huawei user' },
  { id: 'Not App Related', title: 'Not App Related' },
  { id: 'Unspecified / No Response', title: 'Unspecified / Other' }
];

async function sendIssueTypeList(phoneNumber) {
  if (!accessToken || !phoneNumberId) return;
  try {
    await fetch(
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
          type: 'interactive',
          interactive: {
            type: 'list',
            body: { text: 'Thanks for reaching out! To help you faster, what is this about?' },
            action: { button: 'Select issue type', sections: [{ title: 'Issue Type', rows: ISSUE_TYPE_LIST_ROWS }] }
          }
        })
      }
    );
  } catch (err) {
    console.error('Could not send issue type list:', err.message);
  }
}

// South African public holidays for 2026 (source: gov.za). This list needs
// a manual refresh every year — Good Friday/Family Day move with Easter,
// and any holiday landing on a Sunday shifts the following Monday to a
// holiday too (per the Public Holidays Act). Saturdays do NOT shift.
const SA_PUBLIC_HOLIDAYS_2026 = [
  '2026-01-01', // New Year's Day
  '2026-03-21', // Human Rights Day
  '2026-04-03', // Good Friday
  '2026-04-06', // Family Day
  '2026-04-27', // Freedom Day
  '2026-05-01', // Workers' Day
  '2026-06-16', // Youth Day
  '2026-08-09', // National Women's Day
  '2026-08-10', // National Women's Day observed (falls on a Sunday)
  '2026-09-24', // Heritage Day
  '2026-12-16', // Day of Reconciliation
  '2026-12-25', // Christmas Day
  '2026-12-26', // Day of Goodwill
];

function isWithinBusinessHours(date) {
  // Shift to SAST (UTC+2, no daylight saving) and read wall-clock time via
  // the UTC getters on the shifted date — a standard trick that works
  // correctly year-round since South Africa never changes its offset.
  const sast = new Date(date.getTime() + 2 * 60 * 60 * 1000);
  const day = sast.getUTCDay(); // 0 = Sunday ... 6 = Saturday
  if (day === 0 || day === 6) return false;
  const minutesSinceMidnight = sast.getUTCHours() * 60 + sast.getUTCMinutes();
  if (minutesSinceMidnight < 8 * 60 || minutesSinceMidnight >= 17 * 60) return false;
  const dateStr = sast.toISOString().split('T')[0];
  if (SA_PUBLIC_HOLIDAYS_2026.includes(dateStr)) return false;
  return true;
}

async function sendAfterHoursMessage(phoneNumber) {
  if (!accessToken || !phoneNumberId) return;
  const text = "Thanks for messaging POLMED Connect Helpdesk! Our agents are available Monday–Friday, 08:00–17:00 (SA time), and we're currently offline.\n\n" +
    "To help us assist you faster once we're back, please reply with:\n" +
    "1. A description of what you're struggling with in the POLMED Connect app\n" +
    "2. Your membership number\n" +
    "3. Your ID number\n" +
    "4. Your email address\n\n" +
    "We'll follow up as soon as we're back online.";
  try {
    await fetch(
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
          text: { body: text }
        })
      }
    );
  } catch (err) {
    console.error('Could not send after-hours message:', err.message);
  }
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

  // PRIORITY FIX #3: no signed URL generated here anymore. Only the storage
  // path is returned. The dashboard requests a short-lived signed URL on
  // demand, each time an agent actually opens the ticket, via get-media-url.js.
  return filePath;
}

exports.handler = async function (event) {
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

  const sigCheck = checkSignature(event);
  if (!sigCheck.ok) {
    if (sigCheck.reason === 'config_error') {
      console.error('WHATSAPP_APP_SECRET not set — rejecting webhook POST');
      await recordHealth('config_error', 'WHATSAPP_APP_SECRET is not set in environment variables');
    } else {
      console.error('Rejected webhook POST: invalid or missing x-hub-signature-256');
      // Not a health problem — a forged/bad request is the security check
      // working as intended. No alert, no banner.
    }
    return { statusCode: 401, body: 'Invalid signature' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const change  = body?.entry?.[0]?.changes?.[0];
  const message = change?.value?.messages?.[0];
  if (!message) return { statusCode: 200, body: 'Not a message event' };
  await markMessageAsRead(message?.id);

  const sender = message?.from || 'unknown';
  const waMessageId = message?.id || null;
  const now    = new Date();

  let text     = message?.text?.body || '';
  let mediaPath = null;
  let mediaType = null;
  let selectedIssueType = null;

  const ds = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
  const ts = `${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
  const tempIdForMedia = `TMP-${ds}-${ts}`;

  if (MEDIA_TYPES.includes(message.type)) {
    const mediaObj = message[message.type];
    mediaType = message.type;
    text      = mediaObj?.caption || `[${message.type} attached]`;
    try {
      mediaPath = await fetchAndStoreMedia(mediaObj.id, mediaObj.mime_type, tempIdForMedia);
    } catch (err) {
      console.error('Media fetch/store failed:', err.message);
      text = `[${message.type} attached — could not be retrieved, ask member to resend]`;
    }
  } else if (message.type === 'reaction') {
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
  } else if (message.type === 'interactive' && message.interactive?.type === 'list_reply') {
    const selected = message.interactive.list_reply;
    selectedIssueType = selected?.id || null;
    text = `Selected issue type: ${selected?.title || selected?.id || 'unknown'}`;
  } else if (!text) {
    text = `[Unsupported message type: ${message.type || 'unknown'}]`;
  }

  try {
    const db = admin.firestore();

    // Continuation suggestion: doesn't auto-merge or auto-reopen anything.
    // A still-open ticket (New/In Progress) is threaded onto exactly as
    // before. If the sender's most recent ticket was closed (Resolved/
    // Unresolved/Redirected) within the last 30 days, we tag the new
    // ticket about to be created with a pointer to it, so the dashboard
    // can ask the agent to confirm whether it's a continuation.
    const CONTINUATION_STATUSES  = ['Resolved', 'Unresolved', 'Redirected'];
    const CONTINUATION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
    let continuationSuggestion = null;

    const recentSnap = await db.collection('tickets')
      .where('phoneNumber', '==', sender)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();

    if (!recentSnap.empty) {
      const ticketDoc  = recentSnap.docs[0];
      const ticketData = ticketDoc.data();

      if (OPEN_STATUSES.includes(ticketData.status)) {
        const newEntry = {
          from: 'member',
          text,
          mediaPath,
          mediaType,
          waMessageId,
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
        await recordHealth('ok');
        return { statusCode: 200, body: JSON.stringify({ ok: true, ticketId: ticketData.ticketId, appended: true }) };
      }

      if (CONTINUATION_STATUSES.includes(ticketData.status)) {
        const closedAtMs = ticketData.updatedAt?.toMillis ? ticketData.updatedAt.toMillis() : 0;
        if (closedAtMs && (now.getTime() - closedAtMs) < CONTINUATION_WINDOW_MS) {
          continuationSuggestion = {
            ticketDocId: ticketDoc.id,
            ticketId: ticketData.ticketId,
            closedStatus: ticketData.status
          };
        }
      }
    }

    const ticketId = `TKT-${ds}-WA-${ts}`;

    let finalMediaPath = mediaPath;
    if (mediaPath) {
      try {
        const bucket = admin.storage().bucket();
        const ext = mediaPath.split('.').pop();
        const oldFile = bucket.file(`whatsapp-media/${tempIdForMedia}.${ext}`);
        const newFile = bucket.file(`whatsapp-media/${ticketId}.${ext}`);
        await oldFile.move(newFile);
        finalMediaPath = `whatsapp-media/${ticketId}.${ext}`;
      } catch (err) {
        console.error('Could not rename media file to final ticket ID:', err.message);
        // fall back to the temp path — not fatal
      }
    }

        const ticket = {
      ticketId,
      contactMethod: 'WhatsApp',
      source:        'whatsapp-webhook',
      status:        'New',
      message:       text,
      mediaPath:     finalMediaPath,
      mediaType,
      phoneNumber:   sender,
      identifier: '',
      description:   '',
      issueType:     '',
      conversation:  [{ from: 'member', text, mediaPath: finalMediaPath, mediaType, waMessageId, at: now.toISOString() }],
      dateReceived:  now.toISOString().split('T')[0],
      timeReceived:  now.toTimeString().split(' ')[0],
      createdBy:     'WhatsApp webhook',
      createdAt:     admin.firestore.FieldValue.serverTimestamp(),
      updatedBy:     'WhatsApp webhook',
      updatedAt:     admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection('tickets').add(ticket);
    // Only fires on a genuinely new conversation (not on messages threaded
    // onto an already-open ticket), so a member texting repeatedly at
    // 2am doesn't get spammed with the after-hours notice every time.
    if (isWithinBusinessHours(now)) {
      await sendIssueTypeList(sender);
    } else {
      await sendAfterHoursMessage(sender);
    }
    console.log('New ticket created:', ticketId, 'from sender:', sender.slice(-4), mediaType ? `(media: ${mediaType})` : '');
    await recordHealth('ok');
    return { statusCode: 200, body: JSON.stringify({ ok: true, ticketId }) };

  } catch (err) {
    console.error('Firestore error:', err.message);
    await recordHealth('processing_error', err.message);
    return { statusCode: 500, body: 'Error creating/updating ticket: ' + err.message };
  }
};