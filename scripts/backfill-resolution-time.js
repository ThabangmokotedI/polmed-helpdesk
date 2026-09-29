// scripts/backfill-resolution-time.js
//
// Backfills resolutionTime / rtInHours on Resolved tickets that are missing
// it, using the same logic the client-side auto-fill was always supposed to
// apply (see the fix to the status-change listener in js/tickets.js): time
// from the member's first message to the moment the ticket's status was
// actually changed to "Resolved", read from that ticket's own auditLog
// (which records exact timestamps for status changes).
//
// Deliberately does NOT fall back to `updatedAt` when there's no genuine
// audit entry pinning the resolution moment — updatedAt can reflect any
// later, unrelated edit, and legacy bulk-imported tickets (source: 'import')
// are excluded entirely, since their timestamps are import-script artifacts
// rather than real activity. Better to leave a ticket blank than backfill a
// guess.
//
// SETUP: serviceAccountKey.json must already be next to this script (same
// one the other scripts/ tools use).
//
// RUN:
//   DRY_RUN=1 node scripts/backfill-resolution-time.js   -> prints the plan, writes nothing
//   node scripts/backfill-resolution-time.js             -> writes to Firestore
//
// Safe to re-run: only ever touches tickets that are still missing
// resolutionTime, so anything it already wrote is left alone next time.

const admin = require('firebase-admin');
const path  = require('path');

const SERVICE_ACCOUNT = path.join(__dirname, 'serviceAccountKey.json');
const serviceAccount = require(SERVICE_ACCOUNT);

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const DRY_RUN = process.env.DRY_RUN === '1';

function formatDuration(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) return remMins ? `${hours}h ${remMins}m` : `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

function firstMemberAt(t) {
  const convo = Array.isArray(t.conversation) ? t.conversation : [];
  const memberEntries = convo.filter(e => e.from === 'member' && e.at).map(e => new Date(e.at)).filter(d => !isNaN(d));
  if (memberEntries.length) return new Date(Math.min(...memberEntries.map(d => d.getTime())));
  if (t.createdAt?._seconds) return new Date(t.createdAt._seconds * 1000);
  return null;
}

function resolvedAtFromAudit(t) {
  const audit = Array.isArray(t.auditLog) ? t.auditLog : [];
  let latest = null;
  for (const entry of audit) {
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    const statusChange = changes.find(c => c.field === 'Status' && c.to === 'Resolved');
    if (statusChange && entry.changedAt) {
      const d = new Date(entry.changedAt);
      if (!isNaN(d) && (!latest || d > latest)) latest = d;
    }
  }
  return latest;
}

async function run() {
  const snap = await db.collection('tickets').get();
  const all = [];
  snap.forEach(doc => all.push({ id: doc.id, ...doc.data() }));

  const targets = all.filter(t =>
    t.source !== 'import' &&
    t.status === 'Resolved' &&
    !(t.resolutionTime && String(t.resolutionTime).trim())
  );
  console.log(`Live Resolved tickets missing resolutionTime: ${targets.length}`);

  const plan = [];
  const skipped = [];

  for (const t of targets) {
    const memberAt = firstMemberAt(t);
    const resolvedAt = resolvedAtFromAudit(t);
    if (!memberAt || !resolvedAt) {
      skipped.push({ ticketId: t.ticketId, reason: 'no conversation timestamp or no Status→Resolved audit entry' });
      continue;
    }
    const diffMs = resolvedAt - memberAt;
    if (diffMs <= 0) {
      skipped.push({ ticketId: t.ticketId, reason: `non-positive duration (${diffMs}ms) — timestamps out of order` });
      continue;
    }
    plan.push({
      id: t.id,
      ticketId: t.ticketId,
      resolutionTime: formatDuration(diffMs),
      rtInHours: Number((diffMs / 3600000).toFixed(2)),
      memberAt: memberAt.toISOString(),
      resolvedAt: resolvedAt.toISOString(),
    });
  }

  console.log(`\nComputable: ${plan.length}. Skipped (insufficient data): ${skipped.length}`);
  console.log('\n--- Sample of computed values (first 15) ---');
  plan.slice(0, 15).forEach(p => {
    console.log(`  ${p.ticketId}: ${p.resolutionTime} (${p.rtInHours}h)  member@${p.memberAt} -> resolved@${p.resolvedAt}`);
  });
  if (skipped.length) {
    console.log('\n--- Skipped ---');
    skipped.forEach(s => console.log(`  ${s.ticketId}: ${s.reason}`));
  }

  if (DRY_RUN) {
    console.log('\nDRY RUN — nothing written. Re-run without DRY_RUN=1 to write.');
    return;
  }

  const BATCH_SIZE = 400;
  let written = 0;
  for (let i = 0; i < plan.length; i += BATCH_SIZE) {
    const chunk = plan.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const p of chunk) {
      batch.update(db.collection('tickets').doc(p.id), {
        resolutionTime: p.resolutionTime,
        rtInHours: p.rtInHours,
        auditLog: admin.firestore.FieldValue.arrayUnion({
          changedBy: 'Backfill script (computed from conversation + audit timeline)',
          changedAt: new Date().toISOString(),
          changes: [
            { field: 'Resolution Time', from: null, to: p.resolutionTime },
            { field: 'RT (hours)', from: null, to: p.rtInHours }
          ]
        })
      });
      written++;
    }
    await batch.commit();
    console.log(`Committed batch — ${written} written so far.`);
  }
  console.log(`\nDone. Wrote resolutionTime/rtInHours to ${written} tickets.`);
}

run().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
