// netlify/functions/mark-stale-tickets.js
// Scheduled: runs daily. Flags any ticket still in "New" status that has
// had no member follow-up and no agent action for 10+ calendar days
// (weekends included) as "Stale" — separate from "Unresolved", which
// should only mean an agent actually worked it and couldn't close it.
//
// Requires the same FIREBASE_PROJECT_ID / FIREBASE_SERVICE_ACCOUNT env
// vars already set up for the WhatsApp webhook.

const admin = require('firebase-admin');

const projectId = process.env.FIREBASE_PROJECT_ID;

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
  }
}

const STALE_DAYS = 10;
const STALE_THRESHOLD_MS = STALE_DAYS * 24 * 60 * 60 * 1000;

exports.handler = async function () {
  if (!admin.apps.length) {
    console.error('Firebase not initialized — missing env vars');
    return { statusCode: 500, body: 'Firebase not initialized' };
  }

  const db = admin.firestore();
  const now = Date.now();
  let checked = 0;
  let markedStale = 0;

  try {
    // Single-field query on status — no composite index needed.
    const snap = await db.collection('tickets').where('status', '==', 'New').get();
    checked = snap.size;

    const batch = db.batch();

    snap.forEach(doc => {
      const data = doc.data();

      // Reference point: the member's last activity — falls back to
      // createdAt for tickets that never got a follow-up message.
      const lastMemberMs = data.lastMemberMessageAt?.toMillis?.()
        || data.createdAt?.toMillis?.()
        || 0;

      if (!lastMemberMs) return; // no reliable timestamp — skip rather than guess

      if (now - lastMemberMs >= STALE_THRESHOLD_MS) {
        batch.update(doc.ref, {
          status: 'Stale',
          updatedBy: 'Stale-check (automatic)',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          staleSince: admin.firestore.FieldValue.serverTimestamp()
        });
        markedStale++;
      }
    });

    if (markedStale > 0) await batch.commit();

    console.log(`Stale check: ${checked} New tickets checked, ${markedStale} marked Stale`);
    return { statusCode: 200, body: JSON.stringify({ checked, markedStale }) };

  } catch (err) {
    console.error('Stale check failed:', err.message);
    return { statusCode: 500, body: 'Error: ' + err.message };
  }
};