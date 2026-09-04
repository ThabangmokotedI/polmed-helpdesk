const admin = require('firebase-admin');

const projectId = process.env.FIREBASE_PROJECT_ID;
const SIGNED_URL_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

if (!admin.apps || !admin.apps.length) {
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
    const db = admin.firestore();
    const agentRef = db.collection('agents').doc(decoded.uid);
    const agentSnap = await agentRef.get();

    if (!agentSnap.exists) {
      await agentRef.set({
        email: decoded.email || null,
        role: 'agent',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }

    return { ok: true, uid: decoded.uid, email: decoded.email };
  } catch (err) {
    console.error('Token verification failed:', err.message);
    return { ok: false, statusCode: 401, error: 'Invalid or expired session. Please sign in again.' };
  }
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };
  }

  if (!admin.apps || !admin.apps.length) {
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

  const { path } = body || {};
  if (!path || typeof path !== 'string' || !path.startsWith('whatsapp-media/')) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Invalid or missing path' }) };
  }

  try {
    const bucket = admin.storage().bucket();
    const file = bucket.file(path);
    const [exists] = await file.exists();
    if (!exists) {
      return { statusCode: 404, body: JSON.stringify({ ok: false, error: 'File not found' }) };
    }
    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + SIGNED_URL_TTL_MS
    });
    return { statusCode: 200, body: JSON.stringify({ ok: true, url, expiresInMs: SIGNED_URL_TTL_MS }) };
  } catch (err) {
    console.error('Error generating signed URL:', err.message);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'Could not generate media URL' }) };
  }
};