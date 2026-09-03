// js/tickets.js — POLMED Helpdesk: auth, tickets, reports, role-based access
import { firebaseConfig } from './firebase-config.js';

// ── Firebase module imports ───────────────────────────────────────────────────
const appMod  = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
const authMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
const fsMod   = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');

const { initializeApp, getAuth, onAuthStateChanged, signOut: fbSignOut } = { ...appMod, ...authMod };
const { getFirestore, collection, addDoc, updateDoc, deleteDoc, doc,
        onSnapshot, query, orderBy, serverTimestamp, Timestamp, getDoc, setDoc, arrayUnion } = fsMod;

const HARARE_TIME_ZONE = 'Africa/Harare';

function formatHarareDateTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: HARARE_TIME_ZONE,
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

function formatHarareDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: HARARE_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

function harareInputParts(date) {
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

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ── State ─────────────────────────────────────────────────────────────────────
let currentUser = null;
let currentRole = 'agent';   // 'agent' | 'supervisor'
let tickets     = [];
let editingId   = null;
let formDirty   = false;

// ── Global function exports ───────────────────────────────────────────────────
window.filterTickets    = filterTickets;
window.openNewTicket    = openNewTicket;
  window.openContactMember = openContactMember;
  window.closeContactMember = closeContactMember;
  window.sendContactMember = sendContactMember;
window.editTicketById   = editTicketById;
window.closeModal       = closeModal;
window.saveTicket       = saveTicket;
window.deleteTicket     = deleteTicket;
window.viewTicket       = viewTicket;
window.closeDetail      = closeDetail;
window.editFromDetail   = editFromDetail;
window.signOut          = signOut;
window.renderReports    = renderReports;
window.updateReportPeriod = updateReportPeriod;

// ── Auth state ────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  updateEnvironmentBadge();
  if (!user) {
    window.location.href = 'index.html';
    return;
  }
  currentUser = user;
  currentRole = await fetchUserRole(user.uid);
  finishLoad();
});

async function fetchUserRole(uid) {
  try {
    const snap = await getDoc(doc(db, 'agents', uid));
    if (snap.exists()) return snap.data().role || 'agent';
    await setDoc(doc(db, 'agents', uid), {
      email: currentUser.email,
      role: 'agent',
      createdAt: serverTimestamp()
    });
    return 'agent';
  } catch {
    return 'agent';
  }
}

function finishLoad() {
  setAgentUI(currentUser.email, currentRole);
  document.body.style.visibility = 'visible';
  listenToTickets();
  listenToHealth();
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function setAgentUI(email, role) {
  const name = email.split('@')[0];
  document.getElementById('agent-name').textContent = email;
  document.getElementById('agent-avatar').textContent = name[0]?.toUpperCase() || 'A';
  const roleEl = document.getElementById('agent-role');
  if (roleEl) {
    roleEl.textContent = role === 'supervisor' ? '🛡 Supervisor' : 'Agent';
    roleEl.className   = 'agent-role role-' + role;
  }
}

function updateEnvironmentBadge() {
  const badge = document.getElementById('env-badge');
  if (!badge) return;
  badge.innerHTML = '<span class="live-dot"></span> Live';
  badge.classList.remove('demo');
}

// ── Tickets listener ──────────────────────────────────────────────────────────
function ticketActivityTime(t) {
  let latest = 0;
  const bump = (val) => { if (val && val > latest) latest = val; };

  if (t.createdAt?.toDate) bump(t.createdAt.toDate().getTime());
  else if (t.dateReceived) bump(new Date(t.dateReceived).getTime());

  if (t.updatedAt?.toDate) bump(t.updatedAt.toDate().getTime());

  if (Array.isArray(t.conversation)) {
    t.conversation.forEach(entry => {
      if (entry.at) bump(new Date(entry.at).getTime());
    });
  }
  return latest;
}

function listenToTickets() {
  const q = query(collection(db, 'tickets'), orderBy('createdAt', 'desc'));
  onSnapshot(q, (snapshot) => {
    tickets = snapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        // New / unread tickets are always pinned above everything else,
        // so they never get buried by scrolling. Within each group,
        // most recently active ticket (including replies) comes first.
        const aPin = (a.hasNewReply || a.status === 'New') ? 1 : 0;
        const bPin = (b.hasNewReply || b.status === 'New') ? 1 : 0;
        if (aPin !== bPin) return bPin - aPin;
        return ticketActivityTime(b) - ticketActivityTime(a);
      });
    renderStats();
    filterTickets();
    if (document.getElementById('page-reports')?.style.display !== 'none') {
      renderReports();
    }
    const detailOverlay = document.getElementById('detail-overlay');
    if (detailOverlay && detailOverlay.classList.contains('open') && editingId) {
      renderConversation(editingId);
      renderTypingBanner(editingId);
      const openTicket = tickets.find(x => x.id === editingId);
      if (openTicket?.hasNewReply) {
        updateDoc(doc(db, 'tickets', editingId), { hasNewReply: false }).catch(() => {});
      }
    }
  });
}
function listenToHealth() {
  onSnapshot(doc(db, 'system', 'webhookHealth'), (snap) => {
    const banner = document.getElementById('health-banner');
    if (!banner) return;
    if (!snap.exists()) { banner.style.display = 'none'; return; }
    const data = snap.data();
    const isProblem = data.lastStatus === 'config_error' || data.lastStatus === 'processing_error';
    if (isProblem) {
      const when = data.lastErrorAt?.toDate ? formatHarareDateTime(data.lastErrorAt.toDate()) : '';
      banner.textContent = `⚠ WhatsApp webhook issue (${data.lastStatus}): ${data.lastErrorMessage || ''} — ${when}`;
      banner.style.display = 'block';
    } else {
      banner.style.display = 'none';
    }
  }, (err) => console.error('Health listener error:', err.message));
}

// ── Stats bar ─────────────────────────────────────────────────────────────────
function renderStats() {
  const total  = tickets.length;
  const prog   = tickets.filter(t => t.status === 'In Progress').length;
  const res    = tickets.filter(t => t.status === 'Resolved').length;
  const unres  = tickets.filter(t => t.status === 'Unresolved').length;
  const wa     = tickets.filter(t => t.contactMethod === 'WhatsApp').length;
  const em     = tickets.filter(t => t.contactMethod === 'Email').length;
  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-prog').textContent  = prog;
  document.getElementById('stat-res').textContent   = res;
  document.getElementById('stat-unres').textContent = unres;
  document.getElementById('stat-wa').textContent    = wa;
  document.getElementById('stat-email').textContent = em;
  renderUnreadCount();
}

// ── Unread notifications: badge + flashing tab title + sound alert ───────────
let lastUnreadCount = 0;
let flashInterval   = null;
const BASE_TITLE    = 'POLMED Connect — Helpdesk Tracker';

function renderUnreadCount() {
  const unreadCount = tickets.filter(t => t.hasNewReply).length;
  const box     = document.getElementById('unread-count-box');
  const counter = document.getElementById('unread-count');
  if (box && counter) {
    counter.textContent = unreadCount;
    box.style.display = unreadCount > 0 ? 'inline-flex' : 'none';
  }

  // Only alert when unread count goes UP (a genuinely new event),
  // not on every re-render.
  if (unreadCount > lastUnreadCount) {
    playAlertSound();
  }
  lastUnreadCount = unreadCount;

  if (unreadCount > 0) {
    startTitleFlash(unreadCount);
  } else {
    stopTitleFlash();
  }
}

function startTitleFlash(count) {
  if (flashInterval) return; // already flashing
  let showAlert = true;
  flashInterval = setInterval(() => {
    document.title = showAlert ? `🔴 (${count}) New reply!` : BASE_TITLE;
    showAlert = !showAlert;
  }, 1000);
}

function stopTitleFlash() {
  if (flashInterval) {
    clearInterval(flashInterval);
    flashInterval = null;
  }
  document.title = BASE_TITLE;
}

function playAlertSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const g = ctx.createGain();
    g.gain.value = 0.3;
    g.connect(ctx.destination);

    const firstTone = ctx.createOscillator();
    firstTone.type = 'sine';
    firstTone.frequency.value = 880;
    firstTone.connect(g);
    firstTone.start();
    firstTone.stop(ctx.currentTime + 0.18);

    const secondTone = ctx.createOscillator();
    secondTone.type = 'sine';
    secondTone.frequency.value = 1046;
    secondTone.connect(g);
    secondTone.start(ctx.currentTime + 0.26);
    secondTone.stop(ctx.currentTime + 0.26 + 0.22);

    setTimeout(() => { ctx.close(); }, 520);
  } catch {
    // Browsers block audio until the user has interacted with the page at
    // least once in the session — this is normal, not a bug.
  }
}

// ── Filter & render table ─────────────────────────────────────────────────────
function filterTickets() {
  const q  = (document.getElementById('search').value || '').toLowerCase();
  const fs = document.getElementById('filter-status').value;
  const fc = document.getElementById('filter-contact').value;
  const fi = document.getElementById('filter-issue').value;
  const sort = document.getElementById('sort-tickets')?.value || '';
  const showArchived = fs === 'Archived';
  const filtered = tickets.filter(t => {
    const mQ = !q ||
      (t.ticketId    && t.ticketId.toLowerCase().includes(q))    ||
      (t.identifier  && String(t.identifier).toLowerCase().includes(q)) ||
      (t.issueType   && t.issueType.toLowerCase().includes(q))   ||
      (t.description && t.description.toLowerCase().includes(q));
    const mS = showArchived ? t.archived === true : (!fs || t.status === fs);
    const mC = !fc || t.contactMethod === fc;
    const mI = !fi || t.issueType === fi;
    return mQ && mS && mC && mI;
  });
  if (sort) {
    filtered.sort((a, b) => {
      const aReceived = new Date(`${a.dateReceived || ''}T${a.timeReceived || '00:00:00'}`).getTime();
      const bReceived = new Date(`${b.dateReceived || ''}T${b.timeReceived || '00:00:00'}`).getTime();
      return sort === 'received-asc' ? aReceived - bReceived : bReceived - aReceived;
    });
  }
  renderTable(filtered);
}

function renderTable(list) {
  const el = document.getElementById('ticket-list');
  if (!list.length) {
    el.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40">
          <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6M9 13h4"/>
        </svg>
        <p>No tickets found</p>
      </div>`;
    return;
  }
  el.innerHTML = list.map(t => {
    const badge = statusBadge(t.status);
    const ch    = contactIcon(t.contactMethod);
    const date  = t.dateReceived || (t.createdAt?.toDate ? formatHarareDate(t.createdAt.toDate()) : '—');
    const unreadDot = t.hasNewReply
      ? `<span class="unread-dot" title="New member reply" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#f59e0b;margin-right:6px;vertical-align:middle;box-shadow:0 0 0 2px rgba(245,158,11,0.25)"></span>`
      : '';
        const anonTag = t.anonymized ? ` <span class="badge anon" title="Personal data removed after 12 months, per POPIA retention rules">Anonymized</span>` : '';
    return `<div class="table-row" onclick="viewTicket('${t.id}')">
      <div class="td"><span class="tid-pill">${unreadDot}${escapeHtml(t.ticketId) || '—'}</span>${anonTag}</div>
      <div class="td mono">${escapeHtml(t.identifier) || '—'}</div>
      <div class="td issue">${escapeHtml(t.issueType) || '—'}</div>
      <div class="td desc">${escapeHtml(t.description) || '—'}</div>
      <div class="td">${ch} ${escapeHtml(t.contactMethod) || '—'}</div>
      <div class="td date">${escapeHtml(date)}</div>
      <div class="td date">${escapeHtml(t.timeReceived) || '—'}</div>
      <div class="td">${badge}</div>
      <div class="td actions">
        <button class="row-edit-btn" onclick="event.stopPropagation();editTicketById('${t.id}')">
          Edit
        </button>
      </div>
    </div>`;
  }).join('');
}

// ── Ticket CRUD ───────────────────────────────────────────────────────────────
function genTicketId() {
  const d  = new Date();
  const ds = d.getFullYear().toString() +
    (d.getMonth() + 1).toString().padStart(2, '0') +
    d.getDate().toString().padStart(2, '0');
  const todayCount = tickets.filter(t => t.ticketId && t.ticketId.includes(`TKT-${ds}`)).length;
  return `TKT-${ds}-${(todayCount + 1).toString().padStart(3, '0')}`;
}

function openNewTicket() {
  editingId = null;
  document.getElementById('modal-title').textContent = 'New Support Ticket';
  document.getElementById('modal-tid').textContent   = '';
  document.getElementById('wa-tip').style.display    = 'flex';
  document.getElementById('suggest-btn').style.display = 'none';
  document.getElementById('delete-btn').style.display = 'none';
  document.getElementById('save-btn').textContent    = 'Log Ticket';
  clearForm();
  const received = harareInputParts(new Date());
  document.getElementById('f-date').value = received.date;
  document.getElementById('f-time').value = received.time;
  document.getElementById('ticket-overlay').classList.add('open');
  formDirty = false;
}

function openContactMember() {
  document.getElementById('contact-phone').value = '';
  document.getElementById('contact-name').value = '';
  document.getElementById('contact-note').value = '';
  document.getElementById('contact-member-result').textContent = '';
  document.getElementById('contact-member-overlay').classList.add('open');
}

function closeContactMember() {
  document.getElementById('contact-member-overlay').classList.remove('open');
}

async function sendContactMember() {
  const phoneNumber = document.getElementById('contact-phone').value.trim();
  const memberName = document.getElementById('contact-name').value.trim();
  const note = document.getElementById('contact-note').value.trim();
  const resultEl = document.getElementById('contact-member-result');
  const btn = document.getElementById('contact-member-send');
  if (!phoneNumber || !note) {
    resultEl.textContent = 'Phone number and reason/note are required.';
    resultEl.className = 'contact-member-result error';
    return;
  }
  if (!currentUser) {
    resultEl.textContent = 'You are not signed in. Please refresh and try again.';
    resultEl.className = 'contact-member-result error';
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Sending…';
  resultEl.textContent = '';
  try {
    const idToken = await currentUser.getIdToken();
    const res = await fetch('/.netlify/functions/start-whatsapp-conversation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ phoneNumber, memberName, note })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error?.error?.message || data.error || 'Could not start conversation.');
    resultEl.textContent = `Message sent and ticket ${data.ticketId} created.`;
    resultEl.className = 'contact-member-result success';
    document.getElementById('contact-phone').value = '';
    document.getElementById('contact-name').value = '';
    document.getElementById('contact-note').value = '';
  } catch (err) {
    resultEl.textContent = err.message;
    resultEl.className = 'contact-member-result error';
  }
  btn.disabled = false;
  btn.textContent = 'Send';
}

function editTicketById(id) {
  const t = tickets.find(x => x.id === id);
  if (!t) return;
  editingId = id;
  document.getElementById('modal-title').textContent = 'Edit Ticket';
  document.getElementById('modal-tid').textContent   = t.ticketId || '';
  document.getElementById('wa-tip').style.display    = 'none';
  document.getElementById('suggest-btn').style.display = 'inline-flex';
  document.getElementById('delete-btn').style.display =
    currentRole === 'supervisor' ? 'inline-flex' : 'none';
  document.getElementById('save-btn').textContent    = 'Save Changes';
  document.getElementById('f-contact').value         = t.contactMethod || '';
  document.getElementById('f-identifier').value      = t.identifier ||
    (t.phoneNumber
      ? (tickets
          .filter(x => x.phoneNumber === t.phoneNumber && x.id !== t.id && x.identifier)
          .sort((a, b) => ticketActivityTime(b) - ticketActivityTime(a))[0]?.identifier || '')
      : '');
  document.getElementById('f-issue').value           = t.issueType || '';
  document.getElementById('f-description').value     = t.description || '';
  document.getElementById('f-date').value            = t.dateReceived || '';
  document.getElementById('f-time').value            = t.timeReceived || '';
  document.getElementById('f-status').value          = t.status || 'In Progress';
  document.getElementById('f-first-response').value  = t.timeToFirstResponse || '';
  document.getElementById('f-res-time').value        = t.resolutionTime || '';
  document.getElementById('f-rt-hours').value        = t.rtInHours || '';
  document.getElementById('f-resolution').value      = t.resolutionDescription || '';
  document.getElementById('ticket-overlay').classList.add('open');

  autoFillTimingFields(t);
  formDirty = false;
}

function autoFillTimingFields(t) {
  const convo = Array.isArray(t.conversation) ? [...t.conversation].sort((a, b) => new Date(a.at) - new Date(b.at)) : [];
  if (convo.length === 0) return;

  const firstMemberMsg = convo.find(e => e.from === 'member');
  const firstAgentMsg  = convo.find(e => e.from === 'agent');

  const firstResponseField = document.getElementById('f-first-response');
  if (firstMemberMsg && firstAgentMsg && !firstResponseField.value.trim()) {
    const diffMs = new Date(firstAgentMsg.at) - new Date(firstMemberMsg.at);
    if (diffMs > 0) firstResponseField.value = formatDuration(diffMs);
  }

  const status = document.getElementById('f-status').value;
  const resTimeField = document.getElementById('f-res-time');
  const rtHoursField  = document.getElementById('f-rt-hours');
  if (status === 'Resolved' && firstMemberMsg && !resTimeField.value.trim()) {
    const resolvedAt = t.updatedAt?.toDate ? t.updatedAt.toDate() : new Date();
    const diffMs = resolvedAt - new Date(firstMemberMsg.at);
    if (diffMs > 0) {
      resTimeField.value = formatDuration(diffMs);
      rtHoursField.value = (diffMs / 3600000).toFixed(2);
    }
  }
}

function formatDuration(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) return remMins ? `${hours}h ${remMins}m` : `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

document.addEventListener('DOMContentLoaded', () => {
  const statusField = document.getElementById('f-status');
  if (statusField) {
    statusField.addEventListener('change', () => {
      if (editingId) {
        const t = tickets.find(x => x.id === editingId);
        if (t) autoFillTimingFields(t);
      }
    });
  }
});

const ISSUE_KEYWORDS = {
  'Login Issue':                ['login', 'log in', 'can\'t log', 'cannot log', 'password incorrect', 'wrong password', 'sign in'],
  'Forgot username/password':   ['forgot my password', 'forgot password', 'forgot username', 'reset password', 'reset my password'],
  'Onboarding assistance':      ['how do i register', 'how do i sign up', 'new member', 'getting started', 'download the app', 'set up my account'],
  'Membership & documents':     ['membership card', 'member number', 'membership number', 'certificate', 'proof of membership', 'service provider', 'psychologist', 'doctor', 'network provider'],
  'Wellness tracker':           ['wellness', 'step tracker', 'points', 'rewards', 'fitness tracker'],
  'Feature malfunction':        ['not working', 'error', 'crash', 'bug', 'broken', 'glitch', 'won\'t load', 'wont load'],
  'Huawei user':                ['huawei'],
};

window.suggestFromConversation = function () {
  const t = tickets.find(x => x.id === editingId);
  if (!t) return;
  const convo = Array.isArray(t.conversation) ? [...t.conversation].sort((a, b) => new Date(a.at) - new Date(b.at)) : [];
  const memberLines = convo.filter(e => e.from === 'member' && e.text).map(e => e.text);
  const agentLines  = convo.filter(e => e.from === 'agent'  && e.text).map(e => e.text);
  const allMemberText = (t.message ? [t.message, ...memberLines] : memberLines).join(' ').toLowerCase();

  const issueField = document.getElementById('f-issue');
  if (!issueField.value) {
    for (const [type, keywords] of Object.entries(ISSUE_KEYWORDS)) {
      if (keywords.some(k => allMemberText.includes(k))) {
        issueField.value = type;
        break;
      }
    }
  }

  const descField = document.getElementById('f-description');
  if (!descField.value.trim() && memberLines.length) {
    descField.value = (t.message ? [t.message, ...memberLines] : memberLines).join(' — ');
  } else if (!descField.value.trim() && t.message) {
    descField.value = t.message;
  }

  const resDescField = document.getElementById('f-resolution');
  if (document.getElementById('f-status').value === 'Resolved' && !resDescField.value.trim() && agentLines.length) {
    resDescField.value = agentLines.join(' — ');
  }

  const identifierField = document.getElementById('f-identifier');
  if (!identifierField.value.trim()) {
    const match = allMemberText.match(/\b\d{6,12}\b/);
    if (match) identifierField.value = match[0];
  }

  alert('Suggested fields filled in from the conversation — please review before saving, especially Issue Type and Member Identifier.');
};

function closeModal() {
  if (formDirty && !confirm('You have unsaved changes. Discard them?')) return;
  document.getElementById('ticket-overlay').classList.remove('open');
}

// ── Audit trail (who changed what, and when) ─────────────────────────────────
// Not shown anywhere in the UI yet — this just records the data so it's
// available later. Only fields that actually changed are logged, so the
// trail stays compact rather than repeating the whole form on every save.
const AUDIT_FIELDS = {
  contactMethod:          'Contact Method',
  identifier:              'Member Identifier',
  issueType:               'Issue Type',
  description:             'Description',
  dateReceived:            'Date Received',
  timeReceived:            'Time Received',
  status:                  'Status',
  timeToFirstResponse:     'Time to First Response',
  resolutionTime:          'Resolution Time',
  rtInHours:                'RT (hours)',
  resolutionDescription:    'Resolution Notes'
};

// Firestore rejects `undefined` anywhere in a write, and treats '' / null /
// undefined as meaningfully different values for our purposes — so we
// collapse all three to null before comparing, otherwise an untouched empty
// field would get logged as a "change" every single save.
function normalizeAuditValue(v) {
  if (v === undefined || v === '') return null;
  return v;
}

function buildAuditChanges(oldTicket, newData) {
  const changes = [];
  for (const field of Object.keys(AUDIT_FIELDS)) {
    const before = normalizeAuditValue(oldTicket ? oldTicket[field] : null);
    const after  = normalizeAuditValue(newData[field]);
    if (before !== after) {
      changes.push({ field: AUDIT_FIELDS[field], from: before, to: after });
    }
  }
  return changes;
}

async function saveTicket() {
  const contactMethod = document.getElementById('f-contact').value;
  const issueType     = document.getElementById('f-issue').value;
  const description   = document.getElementById('f-description').value.trim();
  const dateReceived  = document.getElementById('f-date').value;
  if (!contactMethod || !issueType || !description || !dateReceived) {
    alert('Please fill in: Contact Method, Issue Type, Description, and Date Received.');
    return;
  }
  const data = {
    contactMethod,
    identifier:          document.getElementById('f-identifier').value.trim(),
    issueType,
    description,
    dateReceived,
    timeReceived:        document.getElementById('f-time').value,
    status:              document.getElementById('f-status').value,
    timeToFirstResponse: document.getElementById('f-first-response').value.trim(),
    resolutionTime:      document.getElementById('f-res-time').value.trim(),
    rtInHours:           parseFloat(document.getElementById('f-rt-hours').value) || null,
    resolutionDescription: document.getElementById('f-resolution').value.trim(),
    updatedBy:           currentUser.email,
    updatedAt:           serverTimestamp()
  };
  const btn = document.getElementById('save-btn');
  btn.disabled    = true;
  btn.textContent = 'Saving…';
  try {
    if (editingId) {
      const oldTicket = tickets.find(x => x.id === editingId);
      const changes = buildAuditChanges(oldTicket, data);
      if (changes.length > 0) {
        // arrayUnion appends one entry to the ticket's own audit history —
        // note serverTimestamp() can't be used *inside* an arrayUnion
        // element (Firestore rejects it there), so we record a plain
        // client-generated ISO timestamp for changedAt instead.
        data.auditLog = arrayUnion({
          changedBy: currentUser.email,
          changedAt: new Date().toISOString(),
          changes
        });
      }
      await updateDoc(doc(db, 'tickets', editingId), data);
    } else {
      data.ticketId  = genTicketId();
      data.createdBy = currentUser.email;
      data.createdAt = serverTimestamp();
      data.source    = 'manual';
      data.auditLog  = [{
        changedBy: currentUser.email,
        changedAt: new Date().toISOString(),
        changes: [{ field: 'Ticket', from: null, to: 'Created' }]
      }];
      await addDoc(collection(db, 'tickets'), data);
    }
    formDirty = false;
    closeModal();
  } catch (e) {
    alert('Error saving ticket: ' + e.message);
  }
  btn.disabled    = false;
  btn.textContent = editingId ? 'Save Changes' : 'Log Ticket';
}

async function deleteTicket() {
  if (!editingId) return;
  if (currentRole !== 'supervisor') {
    alert('Only supervisors can archive tickets.');
    return;
  }
  if (!confirm('Archive this ticket? It will be hidden from the default list but retained for history and duplicate detection.')) return;
  try {
    await updateDoc(doc(db, 'tickets', editingId), {
      archived: true,
      archivedBy: currentUser.email,
      archivedAt: serverTimestamp(),
      updatedBy: currentUser.email,
      updatedAt: serverTimestamp()
    });
    closeModal();
  } catch (e) {
    alert('Error archiving ticket: ' + e.message);
  }
}

// ── HTML escaping helper ─────────────────────────────────────────────────────
// Used everywhere member-supplied or webhook-supplied text is inserted into
// innerHTML, to prevent stored XSS (e.g. a WhatsApp message containing
// "<img src=x onerror=...>" being rendered as live HTML in an agent's browser).
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Ticket detail view ────────────────────────────────────────────────────────
function viewTicket(id) {
  const t = tickets.find(x => x.id === id);
  if (!t) return;
  editingId = id;
  document.getElementById('detail-tid').textContent   = t.ticketId || '—';
  document.getElementById('detail-badge').innerHTML    = statusBadge(t.status);
  const sourceLabel = t.source === 'whatsapp-webhook' ? '🤖 Auto (WhatsApp)'
                    : t.source === 'email-webhook'     ? '🤖 Auto (Email)'
                    : '✍️ Manual';
  const canReplyByWhatsApp = t.contactMethod === 'WhatsApp' && !!t.phoneNumber;
  const suggestedReply = `Thank you for contacting the POLMED Connect Helpdesk. Your ticket reference is ${t.ticketId}. We will follow up with you shortly.`;
  const possibleDuplicate = t.possibleDuplicateOf && !t.possibleDuplicateReviewed
    ? tickets.find(x => x.ticketId === t.possibleDuplicateOf)
    : null;
  const duplicateBanner = possibleDuplicate ? `
    <div class="duplicate-banner" role="alert">
      <strong>Possible duplicate</strong>
      <p>Is this a continuation of ticket <strong>${escapeHtml(possibleDuplicate.ticketId)}</strong>?</p>
      <div class="duplicate-comparison">
        <div><strong>Earlier ticket:</strong> ${escapeHtml(possibleDuplicate.description || possibleDuplicate.message) || 'No description'}</div>
        <div><strong>Status:</strong> ${escapeHtml(possibleDuplicate.status) || '—'} · <strong>Received:</strong> ${escapeHtml(possibleDuplicate.dateReceived) || '—'} ${escapeHtml(possibleDuplicate.timeReceived) || ''}</div>
      </div>
      <div class="duplicate-actions">
        <button type="button" class="btn btn-primary btn-sm" onclick="mergeDuplicateTicket('${t.id}')">Yes, merge</button>
        <button type="button" class="btn btn-sm" onclick="dismissPossibleDuplicate('${t.id}')">No, keep separate</button>
        <button type="button" class="btn btn-sm" onclick="viewTicket('${possibleDuplicate.id}')">View earlier ticket</button>
      </div>
    </div>` : '';

  // ── Returning-member detection ────────────────────────────────────────────
  // Uses the phone number purely as an internal matching key — the number
  // itself is never rendered anywhere below, only a count and, if available,
  // the member's own stated identifier from a past ticket.
      const anonymizedNote = t.anonymized ? `
    <div class="detail-section" style="margin-bottom:10px">
      <div style="display:inline-flex;align-items:center;gap:6px;background:#F1F5F9;color:#475569;border:1px solid #CBD5E1;border-radius:8px;padding:6px 12px;font-size:12.5px;font-weight:500">
        🗄 Anonymized — personal data removed after 12 months per POPIA retention rules. Status and timing stats are preserved.
      </div>
    </div>` : '';

  let returningMemberNote = '';
  if (t.phoneNumber) {
    const priorTickets = tickets
      .filter(x => x.phoneNumber === t.phoneNumber && x.id !== t.id)
      .sort((a, b) => ticketActivityTime(b) - ticketActivityTime(a));
    if (priorTickets.length > 0) {
      const priorWithId = priorTickets.find(x => x.identifier);
      returningMemberNote = `
        <div class="detail-section" style="margin-bottom:10px">
          <div style="display:inline-flex;align-items:center;gap:6px;background:#EEF2FF;color:#4338CA;border:1px solid #C7D2FE;border-radius:8px;padding:6px 12px;font-size:12.5px;font-weight:500">
            🔁 Returning member — ${priorTickets.length} previous ticket${priorTickets.length === 1 ? '' : 's'}
            ${priorWithId ? ` · usually identifies as <strong>${escapeHtml(priorWithId.identifier)}</strong>` : ''}
          </div>
        </div>`;
    }
  }
    document.getElementById('detail-body').innerHTML = `
    ${anonymizedNote}
    ${returningMemberNote}
      ${duplicateBanner}
    <div class="detail-grid">
      <div class="detail-item"><label>Contact Method</label><span>${escapeHtml(t.contactMethod) || '—'}</span></div>
      <div class="detail-item"><label>Member Identifier</label><span>${escapeHtml(t.identifier) || '—'}</span></div>
      <div class="detail-item"><label>Issue Type</label><span>${escapeHtml(t.issueType) || '—'}</span></div>
      <div class="detail-item"><label>Status</label><span>${statusBadge(t.status)}</span></div>
      <div class="detail-item"><label>Date Received</label><span>${escapeHtml(t.dateReceived) || '—'}</span></div>
      <div class="detail-item"><label>Time Received</label><span>${escapeHtml(t.timeReceived) || '—'}</span></div>
      <div class="detail-item"><label>Source</label><span>${sourceLabel}</span></div>
      <div class="detail-item"><label>Time to First Response</label><span>${escapeHtml(t.timeToFirstResponse) || '—'}</span></div>
      <div class="detail-item"><label>Resolution Time</label><span>${escapeHtml(t.resolutionTime) || '—'}</span></div>
      <div class="detail-item"><label>RT (hours)</label><span>${t.rtInHours ?? '—'}</span></div>
      <div class="detail-item"><label>Logged by</label><span>${escapeHtml(t.createdBy) || '—'}</span></div>
      <div class="detail-item"><label>Last updated by</label><span>${escapeHtml(t.updatedBy) || '—'}</span></div>
    </div>
    <div class="detail-section">
      <div class="detail-section-label">Original message</div>
      <div class="detail-block">${escapeHtml(t.message) || '—'}</div>
    </div>
    ${t.mediaPath ? `
    <div class="detail-section">
      <div class="detail-section-label">Attachment</div>
      ${renderMediaHTML(t.mediaPath, t.mediaType, 'large')}
    </div>` : ''}
    ${canReplyByWhatsApp ? `
    <div class="detail-section">
      <div class="detail-section-label">Conversation</div>
      <div id="conversation-thread" class="conversation-thread"></div>
    </div>` : ''}
    <div class="detail-section">
      <div class="detail-section-label">Description</div>
      <div class="detail-block">${escapeHtml(t.description) || '—'}</div>
    </div>
    ${t.resolutionDescription ? `<div class="detail-section"><div class="detail-section-label">Resolution Notes</div><div class="detail-block">${escapeHtml(t.resolutionDescription)}</div></div>` : ''}
    ${canReplyByWhatsApp ? `
    <div class="detail-section">
      <div class="detail-section-label">Reply to member (WhatsApp)</div>
      <div id="typing-indicator" style="display:none;align-items:center;gap:6px;background:#FEF3C7;border:1px solid #FDE68A;color:#92400E;font-size:12px;font-weight:500;padding:7px 12px;border-radius:8px;margin-bottom:8px"></div>
      <div id="quoted-reply-banner" style="display:none"></div>
      <div style="display:none;align-items:center;gap:8px;margin-bottom:8px">
        <input type="file" id="reply-file-input" accept="image/*,video/*,.pdf,.doc,.docx" style="display:none" onchange="onAttachmentSelected(this)">
        <button type="button" class="btn btn-sm" onclick="document.getElementById('reply-file-input').click()">📎 Attach file</button>
        <span id="reply-file-name" style="font-size:12px;color:#6B8580;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
        <button type="button" class="btn btn-sm" id="reply-file-clear" onclick="clearAttachment()" style="display:none">✕</button>
      </div>
      <select id="quick-reply-select" style="width:100%;margin-bottom:8px;padding:7px;border-radius:8px;border:1px solid #ddd;font:inherit;background:#fafafa"></select>
      <textarea id="detail-reply-text" rows="3"
        style="width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid #ddd;font:inherit;resize:vertical"
      >${escapeHtml(suggestedReply)}</textarea>
    </div>` : ''}
  `;
  document.getElementById('copy-reply-btn').style.display = t.ticketId ? 'inline-flex' : 'none';
  document.getElementById('send-reply-btn').style.display = canReplyByWhatsApp ? 'inline-flex' : 'none';
  document.getElementById('detail-overlay').classList.add('open');
  if (canReplyByWhatsApp) {
    renderConversation(id);
    if (typeof populateQuickReplies === 'function') populateQuickReplies();
    setupTypingIndicator(id);
    renderTypingBanner(id);
    startTypingWatch(id);
  }

  const ticketUpdates = {};
  if (t.hasNewReply) ticketUpdates.hasNewReply = false;
  if (Object.keys(ticketUpdates).length > 0) {
    updateDoc(doc(db, 'tickets', id), ticketUpdates).catch(() => {});
  }
}

window.dismissPossibleDuplicate = async function (ticketDocId) {
  try {
    await updateDoc(doc(db, 'tickets', ticketDocId), {
      possibleDuplicateReviewed: true,
      possibleDuplicateDecision: 'separate',
      updatedAt: serverTimestamp()
    });
  } catch (err) {
    alert('Could not dismiss duplicate warning: ' + err.message);
  }
};

window.mergeDuplicateTicket = async function (duplicateDocId) {
  const duplicate = tickets.find(x => x.id === duplicateDocId);
  const original = duplicate?.possibleDuplicateOf
    ? tickets.find(x => x.ticketId === duplicate.possibleDuplicateOf)
    : null;
  if (!duplicate || !original) return;
  if (!confirm(`Merge ${duplicate.ticketId} into ${original.ticketId}?`)) return;

  const mergeId = `${duplicate.ticketId}-${Date.now()}`;
  const mergedAt = new Date().toISOString();
  const originalEntries = Array.isArray(duplicate.conversation) ? duplicate.conversation : [];
  const movedEntries = originalEntries.map((entry, index) => ({
    ...entry,
    mergeId,
    mergedAt: new Date(Date.parse(mergedAt) + index).toISOString(),
    originalAt: entry.at
  }));
  const marker = {
    type: 'merge-divider',
    mergeId,
    mergedTicketDocId: duplicate.id,
    mergedTicketId: duplicate.ticketId,
    at: mergedAt,
    text: `Merged from ${duplicate.ticketId} on ${formatHarareDateTime(new Date(mergedAt))}`
  };
  try {
    await updateDoc(doc(db, 'tickets', original.id), {
      conversation: [...(Array.isArray(original.conversation) ? original.conversation : []), marker, ...movedEntries],
      status: 'In Progress',
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.email
    });
    await updateDoc(doc(db, 'tickets', duplicate.id), {
      conversation: [],
      status: 'Merged',
      mergedConversation: originalEntries,
      mergedIntoPreviousStatus: original.status,
      mergedFromStatus: duplicate.status,
      mergedIntoTicketId: original.ticketId,
      mergedIntoTicketDocId: original.id,
      mergeId,
      mergedAt,
      possibleDuplicateReviewed: true,
      possibleDuplicateDecision: 'merged',
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.email
    });
    closeDetail();
  } catch (err) {
    alert('Could not merge tickets: ' + err.message);
  }
};

window.undoMerge = async function (duplicateDocId, mergeId) {
  const duplicate = tickets.find(x => x.id === duplicateDocId);
  const original = duplicate?.mergedIntoTicketDocId ? tickets.find(x => x.id === duplicate.mergedIntoTicketDocId) : null;
  if (!duplicate || !original || duplicate.mergeId !== mergeId) return;
  if (!confirm(`Undo the merge of ${duplicate.ticketId}?`)) return;
  const restoredOriginalConversation = (Array.isArray(original.conversation) ? original.conversation : [])
    .filter(entry => entry.mergeId !== mergeId);
  try {
    await updateDoc(doc(db, 'tickets', original.id), {
      conversation: restoredOriginalConversation,
      status: duplicate.mergedIntoPreviousStatus || 'Resolved',
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.email
    });
    await updateDoc(doc(db, 'tickets', duplicate.id), {
      conversation: duplicate.mergedConversation || [],
      status: duplicate.mergedFromStatus || 'New',
      mergedConversation: null,
      mergedFromStatus: null,
      mergedIntoTicketId: null,
      mergedIntoTicketDocId: null,
      mergeId: null,
      mergedAt: null,
      possibleDuplicateReviewed: true,
      possibleDuplicateDecision: 'merged-undone',
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.email
    });
    closeDetail();
  } catch (err) {
    alert('Could not undo merge: ' + err.message);
  }
};

// ── Media rendering (images, video, voice notes, other files) ───────────────
// PRIORITY FIX #3: media is no longer referenced by a permanent URL. Each
// ticket/conversation entry now stores a mediaPath (a location in Firebase
// Storage) instead of a URL. We resolve that into a short-lived signed URL
// on demand, only when an agent actually views the ticket, via
// get-media-url.js — so member photos/voice notes aren't reachable forever
// by anyone who has an old link.
let mediaPathCache = {}; // path -> { url, expiresAt }
let mediaElCounter = 0;

async function resolveMediaUrl(path) {
  const cached = mediaPathCache[path];
  if (cached && cached.expiresAt > Date.now() + 60000) return cached.url;
  if (!currentUser) return null;
  try {
    const idToken = await currentUser.getIdToken();
    const res = await fetch('/.netlify/functions/get-media-url', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({ path })
    });
    const result = await res.json();
    if (!res.ok || !result.ok) throw new Error(result?.error || 'Could not load attachment');
    mediaPathCache[path] = { url: result.url, expiresAt: Date.now() + (result.expiresInMs || 2 * 60 * 60 * 1000) };
    return result.url;
  } catch (err) {
    console.error('resolveMediaUrl failed:', err.message);
    return null;
  }
}

function renderMediaTagHTML(url, type, size) {
  const maxW = size === 'small' ? '200px' : '100%';
  const safeUrl = escapeHtml(url);
  if (type === 'image' || type === 'sticker') {
    return `<img src="${safeUrl}" alt="Attachment" style="max-width:${maxW};border-radius:8px;border:1px solid #ddd;display:block">`;
  }
  if (type === 'video') {
    return `<video src="${safeUrl}" controls preload="metadata" style="max-width:${maxW};border-radius:8px;border:1px solid #ddd;display:block"></video>`;
  }
  if (type === 'audio' || type === 'voice' || type === 'ptt') {
    return `<audio src="${safeUrl}" controls preload="metadata" style="width:${size === 'small' ? '220px' : '100%'};display:block"></audio>`;
  }
  return `<a href="${safeUrl}" target="_blank" rel="noopener" class="btn btn-sm" style="display:inline-block">Open ${escapeHtml(type) || 'file'}</a>`;
}

function renderMediaHTML(mediaPath, type, size) {
  if (!mediaPath) return '';
  const elId = `media-${mediaElCounter++}`;
  resolveMediaUrl(mediaPath).then(url => {
    const el = document.getElementById(elId);
    if (!el) return; // ticket modal was closed before this resolved — nothing to update
    if (!url) {
      el.innerHTML = `<div style="color:#c0392b;font-size:12px;margin-top:4px">Could not load attachment</div>`;
      return;
    }
    el.innerHTML = renderMediaTagHTML(url, type, size);
  });
  return `<div id="${elId}" style="margin-top:6px;color:#888;font-size:12px">Loading attachment…</div>`;
}

const REACTION_EMOJIS = ['👍', '🙏', '✅', '❤️', '😊', '🎉'];
let currentReplyTarget = null; // { waMessageId, text } or null

function renderReplyBanner() {
  const el = document.getElementById('quoted-reply-banner');
  if (!el) return;
  if (!currentReplyTarget) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  el.style.display = 'flex';
  const preview = (currentReplyTarget.text || '').slice(0, 120);
  el.innerHTML = `
    <div class="quoted-reply-text">Replying to: "${escapeHtml(preview)}"</div>
    <button type="button" class="quoted-reply-cancel" onclick="cancelQuotedReply()">✕</button>
  `;
}

let pendingAttachment = null; // { file, base64, mimeType, fileName } or null

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

window.onAttachmentSelected = async function (input) {
  const file = input.files?.[0];
  const nameEl = document.getElementById('reply-file-name');
  if (!file) {
    pendingAttachment = null;
    if (nameEl) nameEl.textContent = '';
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    alert('That file is too large — please keep attachments under 5MB.');
    input.value = '';
    pendingAttachment = null;
    if (nameEl) nameEl.textContent = '';
    return;
  }
  try {
    const base64 = await fileToBase64(file);
    pendingAttachment = { base64, mimeType: file.type, fileName: file.name };
    if (nameEl) nameEl.textContent = file.name;
    const clearBtn = document.getElementById('reply-file-clear'); if (clearBtn) clearBtn.style.display = 'inline-flex';
  } catch (err) {
    alert('Could not read that file: ' + err.message);
    pendingAttachment = null;
  }
};

window.clearAttachment = function () {
  pendingAttachment = null;
  const input = document.getElementById('reply-file-input');
  const nameEl = document.getElementById('reply-file-name');
  if (input) input.value = '';
  if (nameEl) nameEl.textContent = '';
  const clearBtn2 = document.getElementById('reply-file-clear'); if (clearBtn2) clearBtn2.style.display = 'none';
};

async function sendPendingAttachment(t, caption) {
  const idToken = await currentUser.getIdToken();
  const res = await fetch('/.netlify/functions/send-whatsapp-media', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
    body: JSON.stringify({
      ticketId: t.ticketId,
      phoneNumber: t.phoneNumber,
      fileBase64: pendingAttachment.base64,
      mimeType: pendingAttachment.mimeType,
      fileName: pendingAttachment.fileName,
      caption
    })
  });
  const result = await res.json();
  if (!res.ok || !result.ok) {
    throw new Error(
      result?.error?.error?.message ||
      (typeof result?.error === 'string' ? result.error : null) ||
      'Could not send attachment.'
    );
  }
  return result;
}

window.startQuotedReply = function (waMessageId) {
  const t = tickets.find(x => x.id === editingId);
  if (!t) return;
  const convo = Array.isArray(t.conversation) ? t.conversation : [];
  const original = convo.find(e => e.waMessageId === waMessageId);
  if (!original) return;
  currentReplyTarget = { waMessageId, text: original.text };
  renderReplyBanner();
  const textarea = document.getElementById('detail-reply-text');
  if (textarea) textarea.focus();
};

window.cancelQuotedReply = function () {
  currentReplyTarget = null;
  renderReplyBanner();
};

window.sendReactionToMessage = async function (waMessageId, emoji) {
  const t = tickets.find(x => x.id === editingId);
  if (!t || !t.phoneNumber) return;
  try {
    if (!currentUser) throw new Error('You are not signed in. Please refresh and log in again.');
    const idToken = await currentUser.getIdToken();
    const res = await fetch('/.netlify/functions/send-whatsapp-interaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
      body: JSON.stringify({
        ticketId: t.ticketId,
        phoneNumber: t.phoneNumber,
        targetMessageId: waMessageId,
        mode: 'reaction',
        emoji
      })
    });
    const result = await res.json();
    if (!res.ok || !result.ok) {
      throw new Error(
        result?.error?.error?.message ||
        (typeof result?.error === 'string' ? result.error : null) ||
        'Could not send reaction.'
      );
    }
    updateDoc(doc(db, 'tickets', t.id), { updatedAt: serverTimestamp() }).catch(() => {});
  } catch (e) {
    alert('Error sending reaction: ' + e.message);
  }
};

// ── Conversation thread (WhatsApp back-and-forth) ───────────────────────────
function renderConversation(id) {
  const el = document.getElementById('conversation-thread');
  if (!el) return;
  const t = tickets.find(x => x.id === id);
  if (!t) return;

  const convo = Array.isArray(t.conversation) ? t.conversation : [];
  if (convo.length === 0) {
    el.innerHTML = `<div class="detail-block" style="color:#888">No messages yet beyond the original one above.</div>`;
    return;
  }

  const sorted = [...convo].sort((a, b) => new Date(a.mergedAt || a.at) - new Date(b.mergedAt || b.at));

  el.innerHTML = sorted.map(entry => {
    if (entry.type === 'merge-divider') {
      return `<div class="convo-merge-divider">
        <span>— ${escapeHtml(entry.text)} —</span>
        <button type="button" class="convo-undo-merge" onclick="undoMerge('${entry.mergedTicketDocId}', '${entry.mergeId}')">Undo merge</button>
      </div>`;
    }
    const isAgent = entry.from === 'agent';
    const when = entry.at ? formatHarareDateTime(new Date(entry.originalAt || entry.at)) : '';

    if (isAgent && entry.isReaction) {
      return `<div class="convo-reaction-line">${escapeHtml(when)} — ${escapeHtml(entry.text)}</div>`;
    }

    const mediaHtml = renderMediaHTML(entry.mediaPath, entry.mediaType, 'small');

    let quotedHtml = '';
    if (isAgent && entry.repliedToMessageId) {
      const original = sorted.find(e => e.waMessageId === entry.repliedToMessageId);
      const quotedText = original ? original.text : null;
      if (quotedText) {
        quotedHtml = `<div class="convo-quoted">${escapeHtml(quotedText.slice(0, 140))}</div>`;
      }
    }

    const actionBar = (!isAgent && entry.waMessageId)
      ? `<div class="convo-actions">
          <button type="button" class="convo-action-btn" onclick="startQuotedReply('${entry.waMessageId}')" title="Reply to this message">↩</button>
          ${REACTION_EMOJIS.map(e => `<button type="button" class="convo-action-btn" onclick="sendReactionToMessage('${entry.waMessageId}', '${e}')" title="React">${e}</button>`).join('')}
        </div>`
      : '';

    return `
      <div class="convo-bubble-wrap ${isAgent ? 'convo-agent-wrap' : 'convo-member-wrap'}">
        <div class="convo-bubble ${isAgent ? 'convo-agent' : 'convo-member'}">
          <div class="convo-meta">${isAgent ? 'You (agent)' : 'Member'} · ${escapeHtml(when)}</div>
          ${quotedHtml}
          <div class="convo-text">${escapeHtml(entry.text)}</div>
          ${mediaHtml}
        </div>
        ${actionBar}
      </div>
    `;
  }).join('');

  el.scrollTop = el.scrollHeight;
}

// ── "Someone is already replying" indicator ──────────────────────────────────
// Stored on the ticket doc as typingBy.<uid> = { email, at } (a plain millis
// timestamp, not serverTimestamp, so we can check staleness locally without
// a round trip). An entry older than TYPING_TTL_MS is treated as gone even
// if it was never explicitly cleared (e.g. the agent's tab crashed).
const TYPING_TTL_MS = 6000;
let typingStopTimer  = null;
let typingWatchTimer = null;
let lastTypingWrite   = 0;

function setupTypingIndicator(ticketId) {
  const textarea = document.getElementById('detail-reply-text');
  if (!textarea) return;
  textarea.addEventListener('input', () => {
    markTyping(ticketId);
    clearTimeout(typingStopTimer);
    typingStopTimer = setTimeout(() => clearTyping(ticketId), 4000);
  });
}

async function markTyping(ticketId) {
  if (!currentUser) return;
  const now = Date.now();
  if (now - lastTypingWrite < 2000) return; // throttle writes while actively typing
  lastTypingWrite = now;
  try {
    await updateDoc(doc(db, 'tickets', ticketId), {
      [`typingBy.${currentUser.uid}`]: { email: currentUser.email, at: now }
    });
  } catch { /* best-effort, don't interrupt typing on a failed write */ }
}

async function clearTyping(ticketId) {
  if (!currentUser || !ticketId) return;
  lastTypingWrite = 0;
  try {
    await updateDoc(doc(db, 'tickets', ticketId), {
      [`typingBy.${currentUser.uid}`]: null
    });
  } catch { /* ignore */ }
}

function renderTypingBanner(ticketId) {
  const t  = tickets.find(x => x.id === ticketId);
  const el = document.getElementById('typing-indicator');
  if (!t || !el) return;
  const now = Date.now();
  const others = Object.entries(t.typingBy || {})
    .filter(([uid, info]) => uid !== currentUser?.uid && info && info.at && (now - info.at) < TYPING_TTL_MS)
    .map(([, info]) => info.email.split('@')[0]);
  if (others.length) {
    el.style.display = 'flex';
    el.innerHTML = `✏️ <strong>${escapeHtml(others.join(', '))}</strong> ${others.length > 1 ? 'are' : 'is'} already replying to this member right now — check before you send.`;
  } else {
    el.style.display = 'none';
    el.innerHTML = '';
  }
}

function startTypingWatch(ticketId) {
  stopTypingWatch();
  // Re-checks staleness every couple of seconds even without a new
  // Firestore snapshot, so a stuck/crashed tab's indicator still clears.
  typingWatchTimer = setInterval(() => renderTypingBanner(ticketId), 2000);
}

function stopTypingWatch() {
  if (typingWatchTimer) { clearInterval(typingWatchTimer); typingWatchTimer = null; }
}

window.addEventListener('beforeunload', () => {
  if (editingId) clearTyping(editingId);
});

function closeDetail() {
  if (editingId) clearTyping(editingId);
  clearTimeout(typingStopTimer);
  stopTypingWatch();
  currentReplyTarget = null;
  document.getElementById('detail-overlay').classList.remove('open');
}
function editFromDetail() { closeDetail(); editTicketById(editingId); }

window.copyReply = function () {
  const t = tickets.find(x => x.id === editingId);
  if (!t || !t.ticketId) return;
  const reply = `Thank you for contacting the POLMED Connect Helpdesk. Your ticket reference is ${t.ticketId}. We will follow up with you shortly.`;
  navigator.clipboard.writeText(reply)
    .then(() => alert('Reference reply copied to clipboard.'))
    .catch(() => alert('Copy failed. Please try again.'));
};

// SECURITY FIX (priority #1): the WhatsApp reply function now requires a
// Firebase ID token proving the caller is a logged-in Polmed agent. Without
// this, anyone who found the Netlify function URL could send arbitrary
// WhatsApp messages from Polmed's business number to any phone number.
window.sendWhatsAppReply = async function () {
  const t = tickets.find(x => x.id === editingId);
  if (!t || !t.phoneNumber) return;
  const textarea = document.getElementById('detail-reply-text');
  const message = (textarea?.value || '').trim();
  if (!message) { alert('Reply text is empty.'); return; }

  const btn = document.getElementById('send-reply-btn');
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    if (!currentUser) throw new Error('You are not signed in. Please refresh and log in again.');
    const idToken = await currentUser.getIdToken();
    const isQuotedReply = !!currentReplyTarget;
    const url = isQuotedReply ? '/.netlify/functions/send-whatsapp-interaction' : '/.netlify/functions/send-whatsapp-reply';
    const payload = isQuotedReply ? { ticketId: t.ticketId, phoneNumber: t.phoneNumber, targetMessageId: currentReplyTarget.waMessageId, mode: 'reply', message } : { ticketId: t.ticketId, phoneNumber: t.phoneNumber, message };
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` }, body: JSON.stringify(payload) });
    const result = await res.json();
    if (!res.ok || !result.ok) {
      throw new Error( result?.error?.error?.message || (typeof result?.error === 'string' ? result.error : null) || 'Send failed. Note: WhatsApp only allows free-form replies within 24 hours of the member\'s last message — after that, only a pre-approved template can be sent.' );
    }
    alert('Reply sent to the member on WhatsApp.');
    updateDoc(doc(db, 'tickets', t.id), { updatedAt: serverTimestamp() }).catch(() => {});
    clearTimeout(typingStopTimer);
    clearTyping(t.id);
    currentReplyTarget = null;
    renderReplyBanner();
  } catch (e) {
    alert('Error sending WhatsApp reply: ' + e.message);
  }
  btn.disabled = false;
  btn.textContent = originalLabel;
};

// ── Sign out ──────────────────────────────────────────────────────────────────
async function signOut() {
  try { await fbSignOut(auth); } catch { /* ignore */ }
  window.location.href = 'index.html';
}

// ── Badges / icons ────────────────────────────────────────────────────────────
function statusBadge(s) {
  const map = { 'New': 'new', 'Resolved': 'res', 'In Progress': 'prog', 'Unresolved': 'unres', 'Redirected': 'redir', 'Merged': 'merged' };
  return `<span class="badge ${map[s] || ''}">${escapeHtml(s) || '—'}</span>`;
}
function contactIcon(c) {
  if (c === 'WhatsApp') {
    return `<svg viewBox="0 0 24 24" width="14" height="14" fill="#25D366" style="vertical-align:-2px"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.39 1.26 4.81L2 22l5.42-1.36c1.36.72 2.9 1.13 4.62 1.13 5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2zm5.63 14.13c-.24.67-1.4 1.28-1.93 1.34-.53.06-1.02.25-3.44-.72-2.9-1.16-4.75-4.06-4.9-4.25-.14-.19-1.18-1.57-1.18-3s.75-2.13 1.02-2.42c.27-.29.58-.36.78-.36.19 0 .39 0 .56.01.18.01.42-.07.66.5.24.58.83 2 .9 2.14.07.14.12.31.02.5-.1.19-.15.31-.29.48-.15.17-.31.38-.44.51-.14.14-.3.3-.13.58.17.29.77 1.27 1.65 2.06 1.14 1.02 2.1 1.33 2.38 1.48.29.14.46.12.63-.07.17-.19.72-.84.92-1.13.19-.29.38-.24.63-.14.26.1 1.65.78 1.93.92.29.14.48.22.55.34.07.12.07.7-.17 1.37z"/></svg>`;
  }
  return { 'Email': '📧', 'Phone call': '📞', 'In person': '🧑‍💼' }[c] || '';
}
function clearForm() {
  ['f-contact','f-identifier','f-issue','f-description','f-date','f-time',
   'f-first-response','f-res-time','f-rt-hours','f-resolution'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('f-status').value = 'New';
}

// ═════════════════════════════════════════════════════════════════════════════
//  REPORTS DASHBOARD
// ═════════════════════════════════════════════════════════════════════════════
function renderReports() {
  const period  = document.getElementById('report-period')?.value || 'all';
  const subset  = applyPeriodFilter(tickets, period);

  const total      = subset.length;
  const resolved   = subset.filter(t => t.status === 'Resolved').length;
const handled    = subset.filter(t => t.status === 'Resolved' || t.status === 'Redirected').length;
  const rtValues   = subset.filter(t => t.rtInHours > 0 && t.status === 'Resolved')
                           .map(t => t.rtInHours);
  const avgRT      = rtValues.length
    ? (rtValues.reduce((a, b) => a + b, 0) / rtValues.length).toFixed(1)
    : '—';
  const resRate    = total ? Math.round((handled / total) * 100) : 0;
  const waCount    = subset.filter(t => t.contactMethod === 'WhatsApp').length;
  const emCount    = subset.filter(t => t.contactMethod === 'Email').length;
  const phCount    = subset.filter(t => t.contactMethod === 'Phone call').length;
  const inpCount   = subset.filter(t => t.contactMethod === 'In person').length;

  document.getElementById('r-total').textContent   = total;
  document.getElementById('r-avg-rt').textContent  = avgRT === '—' ? '—' : avgRT + ' hrs';
  document.getElementById('r-rate').textContent    = total ? resRate + '%' : '—';
  document.getElementById('r-wa').textContent      = waCount;
  document.getElementById('r-email').textContent   = emCount;
  document.getElementById('r-phone').textContent   = phCount;
  const inpEl = document.getElementById('r-inperson');
  if (inpEl) inpEl.textContent = inpCount;

  renderMonthlyChart(subset);
  renderIssueChart(subset);
  renderStatusChart(subset);
  renderContactChart(subset);
  renderResolutionChart(subset);
}

function applyPeriodFilter(list, period) {
  if (period === 'all') return list;
  const now      = new Date();
  const thisYear = now.getFullYear();
  const thisMon  = now.getMonth();
  if (period === 'this-month') {
    return list.filter(t => {
      const d = ticketDate(t);
      return d && d.getFullYear() === thisYear && d.getMonth() === thisMon;
    });
  }
  if (period === 'last-month') {
    const lm = new Date(thisYear, thisMon - 1, 1);
    return list.filter(t => {
      const d = ticketDate(t);
      return d && d.getFullYear() === lm.getFullYear() && d.getMonth() === lm.getMonth();
    });
  }
  if (period === 'last-3') {
    const cutoff = new Date(thisYear, thisMon - 2, 1);
    return list.filter(t => { const d = ticketDate(t); return d && d >= cutoff; });
  }
  if (period === 'last-6') {
    const cutoff = new Date(thisYear, thisMon - 5, 1);
    return list.filter(t => { const d = ticketDate(t); return d && d >= cutoff; });
  }
  return list;
}

function ticketDate(t) {
  if (t.dateReceived) return new Date(t.dateReceived);
  if (t.createdAt?.toDate) return t.createdAt.toDate();
  return null;
}

function renderMonthlyChart(subset) {
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d     = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    const key   = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = new Intl.DateTimeFormat('en-GB', {
      timeZone: HARARE_TIME_ZONE,
      month: 'short',
      year: '2-digit'
    }).format(d);
    const count = subset.filter(t => {
      const td = ticketDate(t);
      if (!td) return false;
      return `${td.getFullYear()}-${String(td.getMonth() + 1).padStart(2, '0')}` === key;
    }).length;
    months.push({ label, count });
  }
  const maxVal = Math.max(...months.map(m => m.count), 1);
  document.getElementById('monthly-chart').innerHTML =
    `<div class="vbar-group">${months.map(m => `
      <div class="vbar-col">
        <div class="vbar-num">${m.count || ''}</div>
        <div class="vbar-wrap">
          <div class="vbar-fill" style="height:${(m.count / maxVal * 100).toFixed(0)}%"></div>
        </div>
        <div class="vbar-label">${escapeHtml(m.label)}</div>
      </div>`).join('')}
    </div>`;
}

function renderIssueChart(subset) {
  const counts = {};
  subset.forEach(t => {
    const k = t.issueType || 'Unspecified';
    counts[k] = (counts[k] || 0) + 1;
  });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const maxVal = sorted[0]?.[1] || 1;
  const colors = ['#F5A52A','#3B82F6','#10B981','#8B5CF6','#EF4444','#F59E0B','#06B6D4','#EC4899'];
  document.getElementById('issue-chart').innerHTML =
    sorted.length ? sorted.map(([label, val], i) => `
      <div class="hbar-row">
        <div class="hbar-label" title="${escapeHtml(label)}">${escapeHtml(label)}</div>
        <div class="hbar-track">
          <div class="hbar-fill" style="width:${(val/maxVal*100).toFixed(0)}%;background:${colors[i % colors.length]}"></div>
        </div>
        <div class="hbar-val">${val}</div>
      </div>`).join('')
    : '<p class="chart-empty">No data for this period</p>';
}

// ── Shared donut-builder (CSS conic-gradient, no external chart library) ────
function buildDonutHTML(dataArr) {
  const total = dataArr.reduce((s, d) => s + d.val, 0);
  if (!total) return '<p class="chart-empty">No data for this period</p>';

  let cumulative = 0;
  const stops = dataArr
    .filter(d => d.val > 0)
    .map(d => {
      const start = (cumulative / total) * 100;
      cumulative += d.val;
      const end = (cumulative / total) * 100;
      return `${d.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
    }).join(', ');

  const legend = dataArr.map(d => {
    const pct = total ? Math.round((d.val / total) * 100) : 0;
    return `
      <div class="donut-legend-row">
        <span class="donut-dot" style="background:${d.color}"></span>
        <span class="donut-legend-label">${escapeHtml(d.label)}</span>
        <span class="donut-legend-val">${d.val} <span class="hbar-pct">${pct}%</span></span>
      </div>`;
  }).join('');

  return `
    <div class="donut-flex">
      <div class="donut-ring" style="background:conic-gradient(${stops})">
        <div class="donut-hole">${total}</div>
      </div>
      <div class="donut-legend">${legend}</div>
    </div>`;
}

function renderStatusChart(subset) {
  const statuses = [
    { label: 'New',         key: 'New',         color: '#8B5CF6' },
    { label: 'In Progress', key: 'In Progress',  color: '#3B82F6' },
    { label: 'Resolved',    key: 'Resolved',     color: '#10B981' },
    { label: 'Redirected',  key: 'Redirected',   color: '#64748B' },
    { label: 'Unresolved',  key: 'Unresolved',   color: '#EF4444' },
  ];
  const dataArr = statuses.map(s => ({
    label: s.label,
    color: s.color,
    val: subset.filter(t => t.status === s.key).length
  }));
  document.getElementById('status-chart').innerHTML = buildDonutHTML(dataArr);
}

function renderContactChart(subset) {
  const channels = [
    { label: 'WhatsApp',   key: 'WhatsApp',   color: '#25D366' },
    { label: 'Email',      key: 'Email',      color: '#3B82F6' },
    { label: 'Phone call', key: 'Phone call', color: '#F5A52A' },
    { label: 'In person',  key: 'In person',  color: '#8B5CF6' },
  ];
  const dataArr = channels.map(c => ({
    label: c.label,
    color: c.color,
    val: subset.filter(t => t.contactMethod === c.key).length
  }));
  const el = document.getElementById('contact-chart');
  if (el) el.innerHTML = buildDonutHTML(dataArr);
}

function renderResolutionChart(subset) {
  const el = document.getElementById('resolution-chart');
  if (!el) return;

  const resolved = subset.filter(t => t.status === 'Resolved' && typeof t.rtInHours === 'number' && t.rtInHours > 0);
  const buckets = [
    { label: 'Under 1 hour',  test: h => h < 1 },
    { label: '1–4 hours',     test: h => h >= 1 && h < 4 },
    { label: '4–24 hours',    test: h => h >= 4 && h < 24 },
    { label: 'Over 24 hours', test: h => h >= 24 },
  ];
  const counts = buckets.map(b => resolved.filter(t => b.test(t.rtInHours)).length);
  const maxVal = Math.max(...counts, 1);
  const colors = ['#10B981', '#3B82F6', '#F59E0B', '#EF4444'];

  if (!resolved.length) {
    el.innerHTML = '<p class="chart-empty">No resolved tickets with a recorded time yet</p>';
    return;
  }

  el.innerHTML = buckets.map((b, i) => `
    <div class="hbar-row">
      <div class="hbar-label">${escapeHtml(b.label)}</div>
      <div class="hbar-track">
        <div class="hbar-fill" style="width:${(counts[i]/maxVal*100).toFixed(0)}%;background:${colors[i]}"></div>
      </div>
      <div class="hbar-val">${counts[i]}</div>
    </div>`).join('');
}

function updateReportPeriod() { renderReports(); }

// ── Stats export (CSV) ────────────────────────────────────────────────────────
// Respects whatever period is currently selected in the Reports page filter.
// Recomputes everything independently of the existing render*Chart functions,
// so this can't affect the on-screen charts/cards.
function csvEscape(v) {
  const s = (v === null || v === undefined) ? '' : String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

window.downloadStatsCSV = function () {
  const period       = document.getElementById('report-period')?.value || 'all';
  const periodLabel  = document.getElementById('report-period')?.selectedOptions?.[0]?.textContent || period;
  const subset       = applyPeriodFilter(tickets, period);

  const total    = subset.length;
  const handled  = subset.filter(t => t.status === 'Resolved' || t.status === 'Redirected').length;
  const rtValues = subset.filter(t => t.rtInHours > 0 && t.status === 'Resolved').map(t => t.rtInHours);
  const avgRT    = rtValues.length ? (rtValues.reduce((a, b) => a + b, 0) / rtValues.length).toFixed(1) : '';
  const resRate  = total ? Math.round((handled / total) * 100) : 0;

  const rows = [];
  rows.push(['Polmed Connect Helpdesk — Report Export']);
  rows.push(['Period', periodLabel]);
  rows.push(['Generated', formatHarareDateTime(new Date())]);
  rows.push([]);

  rows.push(['KPI', 'Value']);
  rows.push(['Total Tickets', total]);
  rows.push(['Avg Resolution Time (hrs)', avgRT]);
  rows.push(['Resolution Rate (%)', total ? resRate : '']);
  rows.push(['WhatsApp', subset.filter(t => t.contactMethod === 'WhatsApp').length]);
  rows.push(['Email', subset.filter(t => t.contactMethod === 'Email').length]);
  rows.push(['Phone call', subset.filter(t => t.contactMethod === 'Phone call').length]);
  rows.push(['In person', subset.filter(t => t.contactMethod === 'In person').length]);
  rows.push([]);

  rows.push(['Issue Type Breakdown']);
  rows.push(['Issue Type', 'Count']);
  const issueCounts = {};
  subset.forEach(t => {
    const k = t.issueType || 'Unspecified';
    issueCounts[k] = (issueCounts[k] || 0) + 1;
  });
  Object.entries(issueCounts).sort((a, b) => b[1] - a[1]).forEach(([label, val]) => rows.push([label, val]));
  rows.push([]);

  rows.push(['Status Breakdown']);
  rows.push(['Status', 'Count']);
  ['New', 'In Progress', 'Resolved', 'Redirected', 'Unresolved'].forEach(s => {
    rows.push([s, subset.filter(t => t.status === s).length]);
  });
  rows.push([]);

  rows.push(['Resolution Time Buckets (Resolved tickets only)']);
  rows.push(['Bucket', 'Count']);
  const resolvedForBuckets = subset.filter(t => t.status === 'Resolved' && typeof t.rtInHours === 'number' && t.rtInHours > 0);
  const buckets = [
    { label: 'Under 1 hour',  test: h => h < 1 },
    { label: '1–4 hours',     test: h => h >= 1 && h < 4 },
    { label: '4–24 hours',    test: h => h >= 4 && h < 24 },
    { label: 'Over 24 hours', test: h => h >= 24 },
  ];
  buckets.forEach(b => rows.push([b.label, resolvedForBuckets.filter(t => b.test(t.rtInHours)).length]));

  const csv  = rows.map(r => r.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const stamp = new Date().toISOString().split('T')[0];
  a.href = url;
  a.download = `polmed-helpdesk-stats-${period}-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// ── Stats export (PDF) ──────────────────────────────────────────────────────
// Uses the browser's native print-to-PDF instead of a charting/PDF library —
// no new dependency, and the output matches exactly what's on screen (same
// KPI cards, same charts) for whatever period is selected. The layout for
// this (hiding everything except the report) is handled by the @media print
// rule added to app.css.
window.downloadStatsPDF = function () {
  window.print();
};

document.addEventListener('DOMContentLoaded', () => {
  const ticketOverlay = document.getElementById('ticket-overlay');
  if (ticketOverlay) {
    ticketOverlay.addEventListener('input', () => { formDirty = true; });
    ticketOverlay.addEventListener('change', () => { formDirty = true; });
  }
});