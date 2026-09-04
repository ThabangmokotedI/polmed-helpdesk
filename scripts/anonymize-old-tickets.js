// netlify/functions/anonymize-old-tickets.js
// Scheduled: runs daily. Any ticket older than 12 months (POPIA retention
// rule stated on the Setup page) gets its personal data stripped, while
// keeping the fields needed for historical reporting: status, contact
// method, issue type, dates, and resolution timing.
//
// Personal data removed: phoneNumber, identifier, message, description,
// resolutionDescription, conversation (full text + any attachments),
// and any mediaPath (the actual files are also deleted from Storage).
// The audit trail (auditLog) is kept for accountability, but any
// "from"/"to" values that held personal data are blanked out — who
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

exports.handler = async function () {
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

  try {
    // Single-field query on createdAt — no composite index needed.
    // "already anonymized" is filtered in memory rather than as a second
    // where() clause, to avoid requiring another composite index for a
    // once-a-day background job.
    const snap = await db.collection('tickets')
      .where('createdAt', '<=', admin.firestore.Timestamp.fromMillis(cutoffMs))
      .get();

    checked = snap.size;
    const batch = db.batch();

    for (const doc of snap.docs) {
      const data = doc.data();
      if (data.anonymized === true) continue;

      // Collect every media file this ticket references, before wiping
      // the fields that point to them.
      const mediaPaths = [];
      if (data.mediaPath) mediaPaths.push(data.mediaPath);
      if (Array.isArray(data.conversation)) {
        data.conversation.forEach(e => { if (e.mediaPath) mediaPaths.push(e.mediaPath); });
      }
      await deleteMediaFiles(mediaPaths);

      batch.update(doc.ref, {
        phoneNumber: admin.firestore.FieldValue.delete(),
        identifier: '',
        message: '[anonymized]',
        description: data.description ? '[anonymized]' : data.description,
        resolutionDescription: data.resolutionDescription ? '[anonymized]' : data.resolutionDescription,
        conversation: admin.firestore.FieldValue.delete(),
        mediaPath: admin.firestore.FieldValue.delete(),
        mediaType: admin.firestore.FieldValue.delete(),
        typingBy: admin.firestore.FieldValue.delete(),
        auditLog: scrubAuditLog(data.auditLog),
        anonymized: true,
        anonymizedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: 'Anonymize job (automatic)',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      anonymized++;
    }

    if (anonymized > 0) await batch.commit();

    console.log(`Anonymize check: ${checked} tickets past 12 months, ${anonymized} newly anonymized`);
    return { statusCode: 200, body: JSON.stringify({ checked, anonymized }) };

  } catch (err) {
    console.error('Anonymize job failed:', err.message);
    return { statusCode: 500, body: 'Error: ' + err.message };
  }
};