// local-firebase-mock.js — in-memory Firebase mock for demo/dev mode
// Supports: auth, firestore (tickets + agents collections), getDoc, setDoc

let _tickets = JSON.parse(localStorage.getItem('mockTickets') || '[]');
let _agents = JSON.parse(localStorage.getItem('mockAgents') || '[]');
let _listeners = [];
let _authListeners = [];

function persist() {
  localStorage.setItem('mockTickets', JSON.stringify(_tickets));
  localStorage.setItem('mockAgents', JSON.stringify(_agents));
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export function initializeApp() { return {}; }
export function getAuth() { return {}; }

export function onAuthStateChanged(auth, cb) {
  _authListeners.push(cb);
  const email = localStorage.getItem('polmedDemoEmail');
  setTimeout(() => cb(email ? { uid: 'demo-uid', email } : null), 50);
  return () => { _authListeners = _authListeners.filter(f => f !== cb); };
}

export async function signOut() {
  localStorage.removeItem('polmedDemoEmail');
  localStorage.removeItem('polmedDemoMode');
  localStorage.removeItem('polmedDemoRole');
  _authListeners.forEach(cb => cb(null));
}

// ── Demo auth helpers ───────────────────────────────────────────────────────
export async function signInWithEmailAndPassword(auth, email, password) {
  const demoEmail = 'thabangmokotedi38@gmail.com';
  const demoPassword = 'P@ssword1';
  if (email === demoEmail && password === demoPassword) {
    localStorage.setItem('polmedDemoEmail', email);
    localStorage.setItem('polmedDemoMode', 'true');
    localStorage.setItem('polmedDemoRole', 'supervisor');
    // Notify auth listeners that a user signed in
    _authListeners.forEach(cb => cb({ uid: 'demo-uid', email }));
    return { user: { uid: 'demo-uid', email } };
  }
  const err = new Error('Incorrect email or password');
  err.code = 'auth/wrong-password';
  throw err;
}

export async function sendPasswordResetEmail(auth, email) {
  const demoEmail = 'thabangmokotedi38@gmail.com';
  if (email === demoEmail) return Promise.resolve();
  const err = new Error('No user found');
  err.code = 'auth/user-not-found';
  throw err;
}

// ── Firestore helpers ─────────────────────────────────────────────────────────
export function getFirestore() { return { _mock: true }; }

export function collection(db, name) { return { _col: name }; }
export function doc(db, colName, id) { return { _col: colName, _id: id }; }

export function serverTimestamp() { return new Date().toISOString(); }
export const Timestamp = {
  fromDate: (d) => ({ toDate: () => d }),
  now: () => ({ toDate: () => new Date() })
};

function getStore(col) { return col === 'agents' ? _agents : _tickets; }

export async function getDoc(ref) {
  const store = getStore(ref._col);
  const item = store.find(x => x._id === ref._id);
  return {
    exists: () => !!item,
    data: () => item ? { ...item } : undefined,
    id: ref._id
  };
}

export async function setDoc(ref, data) {
  const store = getStore(ref._col);
  const idx = store.findIndex(x => x._id === ref._id);
  const entry = { ...data, _id: ref._id };
  if (idx >= 0) store[idx] = entry; else store.push(entry);
  persist();
  return entry;
}

export async function addDoc(colRef, data) {
  const id = 'mock-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  const store = getStore(colRef._col);
  const entry = { ...data, _id: id };
  store.unshift(entry);
  persist();
  _notify();
  return { id };
}

export async function updateDoc(ref, data) {
  const store = getStore(ref._col);
  const idx = store.findIndex(x => x._id === ref._id);
  if (idx >= 0) {
    store[idx] = { ...store[idx], ...data };
    persist();
    _notify();
  }
}

export async function deleteDoc(ref) {
  const store = getStore(ref._col);
  const idx = store.findIndex(x => x._id === ref._id);
  if (idx >= 0) { store.splice(idx, 1); persist(); _notify(); }
}

export function query(colRef, ...constraints) {
  return { _col: colRef._col, _constraints: constraints };
}
export function orderBy() { return {}; }
export function where() { return {}; }

export function onSnapshot(q, cb) {
  function emit() {
    const store = getStore(q._col);
    const docs = store.map(d => ({
      id: d._id,
      data: () => {
        const { _id, ...rest } = d;
        return {
          ...rest,
          createdAt: { toDate: () => rest.createdAt ? new Date(rest.createdAt) : new Date() }
        };
      }
    }));
    cb({ docs });
  }
  emit();
  _listeners.push(emit);
  return () => { _listeners = _listeners.filter(l => l !== emit); };
}

function _notify() { _listeners.forEach(fn => fn()); }
