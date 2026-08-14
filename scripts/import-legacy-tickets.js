// scripts/import-legacy-tickets.js
//
// ONE-TIME USE. Bulk-imports the historical tickets from tickets_import.json
// into your Firestore 'tickets' collection. Safe to run — it only ADDS new
// documents (each with its own generated ticketId like TKT-20260813-IMP-001),
// it never touches or overwrites your existing tickets.
//
// SETUP (do this once):
//   1. npm install firebase-admin   (if not already installed)
//   2. Put tickets_import.json in the same folder as this script
//      (or edit IMPORT_FILE below to point at it)
//   3. Get your Firebase service account key: same one used for your Netlify
//      FIREBASE_SERVICE_ACCOUNT env var. If you don't have it saved locally,
//      go to console.firebase.google.com → your project → Project settings
//      (gear icon) → Service accounts → Generate new private key, and save
//      the downloaded file as serviceAccountKey.json next to this script.
//
// RUN:
//   node scripts/import-legacy-tickets.js
//
// This does NOT touch usernames, dropdowns, or any other tab — it only
// writes to the 'tickets' collection, matching what you asked for.

const admin = require('firebase-admin');
const fs    = require('fs');
const path  = require('path');

const IMPORT_FILE       = path.join(__dirname, 'tickets_import.json');
const SERVICE_ACCOUNT   = path.join(__dirname, 'serviceAccountKey.json');

if (!fs.existsSync(SERVICE_ACCOUNT)) {
  console.error(`Missing service account key at ${SERVICE_ACCOUNT}`);
  console.error('See the setup instructions at the top of this file.');
  process.exit(1);
}
if (!fs.existsSync(IMPORT_FILE)) {
  console.error(`Missing ${IMPORT_FILE} — copy tickets_import.json next to this script.`);
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT, 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function run() {
  const raw = JSON.parse(fs.readFileSync(IMPORT_FILE, 'utf8'));
  console.log(`Loaded ${raw.length} tickets to import.`);

  // Confirm before writing anything — this is a bulk write to production data.
  const readline = require('readline').createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise(resolve =>
    readline.question(`About to write ${raw.length} tickets to Firestore. Type "yes" to continue: `, resolve)
  );
  readline.close();
  if (answer.trim().toLowerCase() !== 'yes') {
    console.log('Cancelled — nothing was written.');
    process.exit(0);
  }

  // Firestore batches cap at 500 writes each.
  const BATCH_SIZE = 400;
  let written = 0;
  let skippedDuplicates = 0;

  for (let i = 0; i < raw.length; i += BATCH_SIZE) {
    const chunk = raw.slice(i, i + BATCH_SIZE);
    const batch = db.batch();

    for (const t of chunk) {
      // Skip if a ticket with this exact ticketId already exists, so the
      // script is safe to re-run without creating duplicates.
      const existing = await db.collection('tickets').where('ticketId', '==', t.ticketId).limit(1).get();
      if (!existing.empty) {
        skippedDuplicates++;
        continue;
      }

      const docRef = db.collection('tickets').doc(); // auto-generated Firestore doc ID
      const { createdAtISO, updatedAtISO, ...rest } = t;

      batch.set(docRef, {
        ...rest,
        createdAt: admin.firestore.Timestamp.fromDate(new Date(createdAtISO)),
        updatedAt: admin.firestore.Timestamp.fromDate(new Date(updatedAtISO))
      });
      written++;
    }

    await batch.commit();
    console.log(`Committed batch ${Math.floor(i / BATCH_SIZE) + 1} — ${written} written so far.`);
  }

  console.log(`\nDone. Written: ${written}. Skipped as duplicates: ${skippedDuplicates}.`);
}

run().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
