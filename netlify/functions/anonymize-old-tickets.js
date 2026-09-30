// netlify/functions/anonymize-old-tickets.js
// Scheduled: runs daily. Any ticket older than 12 months (POPIA retention
// rule stated on the Setup page) that is also in a CLOSED status gets its
// personal data stripped, while keeping the fields needed for historical
// reporting: status, contact method, issue type, dates, and resolution
// timing.
//
// Still-open tickets (New / In Progress / Stale) are skipped regardless of
// age — anonymizing a ticket nobody has finished handling would strip the
// contact info and message content an agent still needs to actually work
// it, making it permanently unresolvable. Resolved / Unresolved /
// Redirected / Merged are the closed states eligible for anonymization.
//
// Personal data removed: phoneNumber, identifier, message,
// lastMemberMessage, description, resolutionDescription, conversation
// (full text + any attachments), mergedConversation (the backup copy kept
// on a Merged ticket for the "undo merge" feature — otherwise it would
// still hold the original PII even after the live conversation field is
// wiped), fromEmail, and any mediaPath (the actual files are also deleted
// from Storage). The audit trail (auditLog) is kept for accountability,
// but any "from"/"to" values that held personal data are blanked out — who
// changed the ticket and when is preserved, what they typed is not.
//
// A ticket is only ever processed once: anonymized:true is set when done,
// and already-anonymized tickets are skipped on every later run.
//
// Requires the same FIREBASE_PROJECT_ID / FIREBASE_SERVICE_ACCOUNT env
// vars already set up for the other scheduled functions.

const admin = require('firebase-admin');

const projectId = process.env.FIREBASE_PROJECT_ID;

if (!admin.apps.length) {
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
  }
}

// Anonymizing one of these would strip the info an agent still needs to
// actually handle the ticket — age alone isn't enough, it has to be done.
const OPEN_STATUSES = new Set(['New', 'In Progress', 'Stale']);

// Fields that carry personal data inside each auditLog entry's "changes"
// array — their from/to values get blanked, everything else (changedBy,
// changedAt, the field name itself) is kept so the trail still shows
// "an agent changed X at this time", just not what it was changed to.
const PII_AUDIT_FIELDS = new Set([
  'Member Identifier', 'Description', 'Resolution Notes'
]);

function scrubAuditLog(auditLog) {
  if (!Array.isArray(auditLog)) return auditLog;
  return auditLog.map(entry => ({
    ...entry,
    changes: Array.isArray(entry.changes)
      ? entry.changes.map(c =>
          PII_AUDIT_FIELDS.has(c.field)
            ? { ...c, from: c.from ? '[anonymized]' : c.from, to: c.to ? '[anonymized]' : c.to }
            : c
        )
      : entry.changes
  }));
}

async function deleteMediaFiles(paths) {
  if (!paths.length) return;
  const bucket = admin.storage().bucket();
  for (const p of paths) {
    try {
      await bucket.file(p).delete({ ignoreNotFound: true });
    } catch (err) {
      console.error('Could not delete media file:', p, err.message);
    }
  }
}

exports.handler = async function (event) {
  // REVERTED 2026-09-30: this job permanently deletes personal data and
  // files, so it genuinely needs to be restricted to its own schedule --
  // but the X-NF-Event: schedule header check added here used the same
  // logic as mark-stale-tickets.js, and that one's first overnight run
  // showed clear signs of the header gate rejecting Netlify's own
  // scheduled trigger (see that file's comment). Reverting this one too
  // rather than leave a compliance job silently broken on a guess -- safe
  // to do right now specifically because nothing is old enough to be
  // eligible yet (checked: oldest ticket ~9-10 months, cutoff is 12), so
  // an unauthorized trigger today would find zero tickets and do nothing.
  // This needs a real fix before that stops being true.
  console.log('anonymize-old-tickets invoked. Headers:', JSON.stringify(event?.headers || {}));

  if (!admin.apps.length) {
    console.error('Firebase not initialized — missing env vars');
    return { statusCode: 500, body: 'Firebase not initialized' };
  }

  const db = admin.firestore();
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1); // 12 months ago
  const cutoffMs = cutoff.getTime();

  let checked = 0;
  let anonymized = 0;
  let skippedOpen = 0;

  try {
    // Single-field query on createdAt — no composite index needed.
    // "already anonymized" / "still open" are filtered in memory rather
    // than as extra where() clauses, to avoid requiring composite indexes
    // for a once-a-day background job.
    const snap = await db.collection('tickets')
      .where('createdAt', '<=', admin.firestore.Timestamp.fromMillis(cutoffMs))
      .get();

    checked = snap.size;
    const batch = db.batch();

    for (const doc of snap.docs) {
      const data = doc.data();
      if (data.anonymized === true) continue;
      if (OPEN_STATUSES.has(data.status)) { skippedOpen++; continue; }

      // Collect every media file this ticket references, before wiping
      // the fields that point to them.
      const mediaPaths = [];
      if (data.mediaPath) mediaPaths.push(data.mediaPath);
      if (Array.isArray(data.conversation)) {
        data.conversation.forEach(e => { if (e.mediaPath) mediaPaths.push(e.mediaPath); });
      }
      if (Array.isArray(data.mergedConversation)) {
        data.mergedConversation.forEach(e => { if (e.mediaPath) mediaPaths.push(e.mediaPath); });
      }
      await deleteMediaFiles(mediaPaths);

      batch.update(doc.ref, {
        phoneNumber: admin.firestore.FieldValue.delete(),
        identifier: '',
        message: '[anonymized]',
        lastMemberMessage: data.lastMemberMessage ? '[anonymized]' : data.lastMemberMessage,
        description: data.description ? '[anonymized]' : data.description,
        resolutionDescription: data.resolutionDescription ? '[anonymized]' : data.resolutionDescription,
        conversation: admin.firestore.FieldValue.delete(),
        mergedConversation: admin.firestore.FieldValue.delete(),
        mediaPath: admin.firestore.FieldValue.delete(),
        mediaType: admin.firestore.FieldValue.delete(),
        typingBy: admin.firestore.FieldValue.delete(),
        fromEmail: data.fromEmail ? '[anonymized]' : data.fromEmail,
        auditLog: scrubAuditLog(data.auditLog),
        anonymized: true,
        anonymizedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: 'Anonymize job (automatic)',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      anonymized++;
    }

    if (anonymized > 0) await batch.commit();

    console.log(`Anonymize check: ${checked} tickets past 12 months, ${anonymized} newly anonymized, ${skippedOpen} skipped (still open)`);
    return { statusCode: 200, body: JSON.stringify({ checked, anonymized, skippedOpen }) };

  } catch (err) {
    console.error('Anonymize job failed:', err.message);
    return { statusCode: 500, body: 'Error: ' + err.message };
  }
};
