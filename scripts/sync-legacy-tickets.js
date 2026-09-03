// scripts/sync-legacy-tickets.js
//
// Successor to import-legacy-tickets.js. Syncs tickets_import.json into your
// Firestore 'tickets' collection:
//   - A ticketId that doesn't exist yet is ADDED (same as before).
//   - A ticketId that already exists has its status / resolutionTime /
//     resolutionDescription / rtInHours compared against what's in
//     Firestore, and is UPDATED only if something actually changed.
//     Nothing else on the doc is touched.
//
// This is what import-legacy-tickets.js was missing: it treated any existing
// ticketId as a duplicate and skipped it outright, so a ticket that moved
// from "In Progress" to "Resolved" in a newer spreadsheet export never made
// it into Firestore. This script fixes that while keeping the same safety
// model (nothing is deleted, nothing outside the compared fields is
// overwritten, and it's safe to re-run any time you get a fresh export).
//
// SETUP (same as before):
//   1. npm install firebase-admin   (if not already installed)
//   2. Put the latest tickets_import.json in the same folder as this script
//   3. serviceAccountKey.json must already be next to this script (same one
//      import-legacy-tickets.js used)
//
// RUN:
//   node scripts/sync-legacy-tickets.js
//
// Only writes to the 'tickets' collection — same scope as before.

const admin = require('firebase-admin');
const fs    = require('fs');
const path  = require('path');

const IMPORT_FILE     = path.join(__dirname, 'tickets_import.json');
const SERVICE_ACCOUNT = path.join(__dirname, 'serviceAccountKey.json');

// Fields we compare to decide whether an existing ticket needs updating.
// Keep this list narrow and deliberate — we only ever touch what's listed
// here, everything else on the existing doc is left exactly as it is.
const SYNCABLE_FIELDS = ['status', 'resolutionTime', 'resolutionDescription', 'rtInHours'];

if (!fs.existsSync(SERVICE_ACCOUNT)) {
  console.error(`Missing service account key at ${SERVICE_ACCOUNT}`);
  console.error('See the setup instructions at the top of this file.');
  process.exit(1);
}
if (!fs.existsSync(IMPORT_FILE)) {
  console.error(`Missing ${IMPORT_FILE} — copy the latest tickets_import.json next to this script.`);
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT, 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

function diffSyncableFields(existingData, incoming) {
  const changes = {};
  for (const field of SYNCABLE_FIELDS) {
    const oldVal = existingData[field] ?? null;
    const newVal = incoming[field] ?? null;
    
    // For string comparison: trim both sides first.
    // Non-string values (like rtInHours) use exact comparison.
    let oldForComparison = oldVal;
    let newForComparison = newVal;
    if (typeof oldVal === 'string') oldForComparison = oldVal.trim();
    if (typeof newVal === 'string') newForComparison = newVal.trim();
    
    if (oldForComparison !== newForComparison) {
      changes[field] = { from: oldVal, to: newVal };
    }
  }
  return changes;
}

async function run() {
  const raw = JSON.parse(fs.readFileSync(IMPORT_FILE, 'utf8').replace(/^\uFEFF/, ''));
  console.log(`Loaded ${raw.length} tickets from tickets_import.json.`);

  // Dry-run pass first: work out what would actually happen before writing
  // anything, so you can see the scope of the change up front.
  const toCreate = [];
  const toUpdate = []; // { docRef, changes, incoming }
  let unchanged = 0;

  for (const t of raw) {
    const existingSnap = await db.collection('tickets').where('ticketId', '==', t.ticketId).limit(1).get();

    if (existingSnap.empty) {
      toCreate.push(t);
      continue;
    }

    const doc = existingSnap.docs[0];
    const changes = diffSyncableFields(doc.data(), t);

    if (Object.keys(changes).length === 0) {
      unchanged++;
    } else {
      toUpdate.push({ docRef: doc.ref, changes, incoming: t });
    }
  }

  console.log(`\nPlan:`);
  console.log(`  New tickets to add:      ${toCreate.length}`);
  console.log(`  Existing tickets to update: ${toUpdate.length}`);
  console.log(`  Unchanged (skipped):     ${unchanged}`);

  if (toUpdate.length > 0) {
    console.log(`\nSample of changes to be made (first 10):`);
    toUpdate.slice(0, 10).forEach(({ incoming, changes }) => {
      console.log(`  ${incoming.ticketId}:`, changes);
    });
  }

  const readline = require('readline').createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise(resolve =>
    readline.question(
      `\nAbout to add ${toCreate.length} and update ${toUpdate.length} tickets in Firestore. Type "yes" to continue: `,
      resolve
    )
  );
  readline.close();
  if (answer.trim().toLowerCase() !== 'yes') {
    console.log('Cancelled — nothing was written.');
    process.exit(0);
  }

  const BATCH_SIZE = 400;
  let created = 0;
  let updated = 0;

  // Creates, batched the same way the original script did.
  for (let i = 0; i < toCreate.length; i += BATCH_SIZE) {
    const chunk = toCreate.slice(i, i + BATCH_SIZE);
    const batch = db.batch();

    for (const t of chunk) {
      const docRef = db.collection('tickets').doc();
      const { createdAtISO, updatedAtISO, ...rest } = t;
      batch.set(docRef, {
        ...rest,
        createdAt: admin.firestore.Timestamp.fromDate(new Date(createdAtISO)),
        updatedAt: admin.firestore.Timestamp.fromDate(new Date(updatedAtISO))
      });
      created++;
    }

    if (chunk.length > 0) {
      await batch.commit();
      console.log(`Committed create-batch ${Math.floor(i / BATCH_SIZE) + 1} — ${created} created so far.`);
    }
  }

  // Updates, batched separately. Each update writes only the changed fields
  // plus an updatedAt timestamp and an appended audit log entry — it never
  // touches fields that weren't in SYNCABLE_FIELDS.
  for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
    const chunk = toUpdate.slice(i, i + BATCH_SIZE);
    const batch = db.batch();

    for (const { docRef, changes, incoming } of chunk) {
      const fieldUpdates = {};
      for (const field of Object.keys(changes)) {
        fieldUpdates[field] = incoming[field] ?? null;
      }

      const auditEntry = {
        changedBy: 'Bulk sync',
        changedAt: new Date().toISOString(),
        changes: Object.entries(changes).map(([field, { from, to }]) => ({ field, from, to }))
      };

      batch.update(docRef, {
        ...fieldUpdates,
        updatedAt: admin.firestore.Timestamp.fromDate(new Date()),
        updatedBy: 'Bulk sync',
        auditLog: admin.firestore.FieldValue.arrayUnion(auditEntry)
      });
      updated++;
    }

    if (chunk.length > 0) {
      await batch.commit();
      console.log(`Committed update-batch ${Math.floor(i / BATCH_SIZE) + 1} — ${updated} updated so far.`);
    }
  }

  console.log(`\nDone. Created: ${created}. Updated: ${updated}. Unchanged: ${unchanged}.`);
}

run().catch(err => {
  console.error('Sync failed:', err);
  process.exit(1);
});