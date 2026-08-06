// js/tickets.js — Polmed Helpdesk: auth, tickets, reports, role-based access
import { firebaseConfig } from './firebase-config.js';

const isConfigured = firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('REPLACE');
const demoMode = localStorage.getItem('polmedDemoMode') === 'true' ||
  (!isConfigured && !!localStorage.getItem('polmedDemoEmail'));

// ── Firebase module imports ───────────────────────────────────────────────────
let initializeApp, getAuth, onAuthStateChanged, fbSignOut;
let getFirestore, collection, addDoc, updateDoc, deleteDoc, doc,
    onSnapshot, query, orderBy, serverTimestamp, Timestamp, getDoc, setDoc;

if (!isConfigured) {
  const mock = await import('./local-firebase-mock.js');
  ({
    initializeApp, getAuth, onAuthStateChanged,
    getFirestore, collection, addDoc, updateDoc, deleteDoc, doc,
    onSnapshot, query, orderBy, serverTimestamp, Timestamp, getDoc, setDoc,
    signOut: fbSignOut
  } = mock);
} else {
  const appMod  = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
  const authMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
  const fsMod   = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
  initializeApp    = appMod.initializeApp;
  getAuth          = authMod.getAuth;
  onAuthStateChanged = authMod.onAuthStateChanged;
  fbSignOut        = authMod.signOut;
  getFirestore     = fsMod.getFirestore;
  collection       = fsMod.collection;
  addDoc           = fsMod.addDoc;
  updateDoc        = fsMod.updateDoc;
  deleteDoc        = fsMod.deleteDoc;
  doc              = fsMod.doc;
  onSnapshot       = fsMod.onSnapshot;
  query            = fsMod.query;
  orderBy          = fsMod.orderBy;
  serverTimestamp  = fsMod.serverTimestamp;
  Timestamp        = fsMod.Timestamp;
  getDoc           = fsMod.getDoc;
  setDoc           = fsMod.setDoc;
}

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ── State ─────────────────────────────────────────────────────────────────────
let currentUser = null;
let currentRole = 'agent';   // 'agent' | 'supervisor'
let tickets     = [];
let editingId   = null;

// ── Global function exports ───────────────────────────────────────────────────
window.filterTickets    = filterTickets;
window.openNewTicket    = openNewTicket;
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
    if (demoMode) {
      const email = localStorage.getItem('polmedDemoEmail');
      if (email) {
        currentUser = { uid: 'demo-uid', email };
        currentRole = localStorage.getItem('polmedDemoRole') || 'supervisor'; // demo = supervisor
        finishLoad();
        return;
      }
    }
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
    // Auto-create agent document on first login (role = 'agent')
    await setDoc(doc(db, 'agents', uid), {
      email: currentUser.email,
      role: 'agent',
      createdAt: serverTimestamp()
    });
    return 'agent';
  } catch {
    return 'agent'; // safe default
  }
}

function finishLoad() {
  setAgentUI(currentUser.email, currentRole);
  document.body.style.visibility = 'visible';
  listenToTickets();
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
  if (demoMode) {
    badge.innerHTML = '<span class="live-dot"></span> Demo mode';
    badge.classList.add('demo');
  } else {
    badge.innerHTML = '<span class="live-dot"></span> Live';
    badge.classList.remove('demo');
  }
}

// ── Tickets listener ──────────────────────────────────────────────────────────
function listenToTickets() {
  const q = query(collection(db, 'tickets'), orderBy('createdAt', 'desc'));
  onSnapshot(q, (snapshot) => {
    tickets = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderStats();
    filterTickets();
    // Re-render reports if on that page
    if (document.getElementById('page-reports')?.style.display !== 'none') {
      renderReports();
    }
    // If the detail modal is currently open on a ticket, refresh its
    // conversation thread live so a new member reply appears without
    // the agent needing to close and reopen the modal.
    const detailOverlay = document.getElementById('detail-overlay');
    if (detailOverlay && detailOverlay.classList.contains('open') && editingId) {
      renderConversation(editingId);
      // The agent is actively looking at this ticket right now — if a new
      // message just arrived and flagged it unread, clear that immediately
      // rather than waiting for them to close and reopen it.
      const openTicket = tickets.find(x => x.id === editingId);
      if (openTicket?.hasNewReply) {
        updateDoc(doc(db, 'tickets', editingId), { hasNewReply: false }).catch(() => {});
      }
    }
  });
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
  renderNewCount();
}

function renderNewCount() {
  const newCount = tickets.filter(t => t.status === 'New').length;
  const box      = document.getElementById('new-count-box');
  const counter  = document.getElementById('new-count');
  if (!box || !counter) return;
  counter.textContent   = newCount;
  box.style.display = newCount > 0 ? 'inline-flex' : 'none';
  renderUnreadCount();
}

function renderUnreadCount() {
  const unreadCount = tickets.filter(t => t.hasNewReply).length;
  const box     = document.getElementById('unread-count-box');
  const counter = document.getElementById('unread-count');
  if (!box || !counter) return;
  counter.textContent = unreadCount;
  box.style.display = unreadCount > 0 ? 'inline-flex' : 'none';
  // Flash the browser tab title so it's noticeable even if the dashboard
  // tab isn't the one currently focused.
  document.title = unreadCount > 0
    ? `(${unreadCount}) New reply — Polmed Helpdesk`
    : 'Polmed Connect — Helpdesk Tracker';
}

// ── Filter & render table ─────────────────────────────────────────────────────
function filterTickets() {
  const q  = (document.getElementById('search').value || '').toLowerCase();
  const fs = document.getElementById('filter-status').value;
  const fc = document.getElementById('filter-contact').value;
  const fi = document.getElementById('filter-issue').value;
  const filtered = tickets.filter(t => {
    const mQ = !q ||
      (t.ticketId    && t.ticketId.toLowerCase().includes(q))    ||
      (t.identifier  && String(t.identifier).toLowerCase().includes(q)) ||
      (t.issueType   && t.issueType.toLowerCase().includes(q))   ||
      (t.description && t.description.toLowerCase().includes(q));
    const mS = !fs || t.status === fs;
    const mC = !fc || t.contactMethod === fc;
    const mI = !fi || t.issueType === fi;
    return mQ && mS && mC && mI;
  });
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
    const date  = t.dateReceived || (t.createdAt?.toDate ? t.createdAt.toDate().toLocaleDateString('en-ZA') : '—');
    const unreadDot = t.hasNewReply
      ? `<span class="unread-dot" title="New member reply" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#f59e0b;margin-right:6px;vertical-align:middle;box-shadow:0 0 0 2px rgba(245,158,11,0.25)"></span>`
      : '';
    return `<div class="table-row" onclick="viewTicket('${t.id}')">
      <div class="td"><span class="tid-pill">${unreadDot}${t.ticketId || '—'}</span></div>
      <div class="td mono">${t.identifier || '—'}</div>
      <div class="td issue">${t.issueType || '—'}</div>
      <div class="td desc">${t.description || '—'}</div>
      <div class="td">${ch} ${t.contactMethod || '—'}</div>
      <div class="td date">${date}</div>
      <div class="td">${badge}</div>
      <div class="td actions">
        <button class="row-edit-btn" onclick="event.stopPropagation();editTicketById('${t.id}')">
          ${t.status === 'New' ? 'Triage' : 'Edit'}
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
  document.getElementById('delete-btn').style.display = 'none';
  document.getElementById('save-btn').textContent    = 'Log Ticket';
  clearForm();
  document.getElementById('f-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('ticket-overlay').classList.add('open');
}

function editTicketById(id) {
  const t = tickets.find(x => x.id === id);
  if (!t) return;
  editingId = id;
  document.getElementById('modal-title').textContent = 'Edit Ticket';
  document.getElementById('modal-tid').textContent   = t.ticketId || '';
  document.getElementById('wa-tip').style.display    = 'none';
  // Delete button only visible to supervisors
  document.getElementById('delete-btn').style.display =
    currentRole === 'supervisor' ? 'inline-flex' : 'none';
  document.getElementById('save-btn').textContent    = 'Save Changes';
  document.getElementById('f-contact').value         = t.contactMethod || '';
  document.getElementById('f-identifier').value      = t.identifier || '';
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

  // ── Auto-fill timing fields from the actual conversation timestamps ────────
  // These are pure math on real timestamps, so they're safe to fill in
  // automatically without needing an agent to double check them.
  autoFillTimingFields(t);
}

// ── Auto-fill: response/resolution timing (fully automatic, timestamp-based) ─
function autoFillTimingFields(t) {
  const convo = Array.isArray(t.conversation) ? [...t.conversation].sort((a, b) => new Date(a.at) - new Date(b.at)) : [];
  if (convo.length === 0) return;

  const firstMemberMsg = convo.find(e => e.from === 'member');
  const firstAgentMsg  = convo.find(e => e.from === 'agent');

  // Time to First Response — only fill if not already set, so we never
  // overwrite something an agent typed in manually.
  const firstResponseField = document.getElementById('f-first-response');
  if (firstMemberMsg && firstAgentMsg && !firstResponseField.value.trim()) {
    const diffMs = new Date(firstAgentMsg.at) - new Date(firstMemberMsg.at);
    if (diffMs > 0) firstResponseField.value = formatDuration(diffMs);
  }

  // Resolution Time / RT in hours — only auto-fill if the ticket is
  // currently Resolved and these fields are still empty.
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

// ── Suggest: Issue Type / Description / Resolution Description / Member ID ──
// These involve interpreting what was actually said, so rather than silently
// filling them in, this button drafts a best-guess the agent can review,
// edit, or discard before saving — nothing gets written to Firestore here.
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

  // Issue Type — first keyword match wins
  const issueField = document.getElementById('f-issue');
  if (!issueField.value) {
    for (const [type, keywords] of Object.entries(ISSUE_KEYWORDS)) {
      if (keywords.some(k => allMemberText.includes(k))) {
        issueField.value = type;
        break;
      }
    }
  }

  // Description — draft from the member's messages
  const descField = document.getElementById('f-description');
  if (!descField.value.trim() && memberLines.length) {
    descField.value = (t.message ? [t.message, ...memberLines] : memberLines).join(' — ');
  } else if (!descField.value.trim() && t.message) {
    descField.value = t.message;
  }

  // Resolution Description — draft from the agent's messages, only when Resolved
  const resDescField = document.getElementById('f-resolution');
  if (document.getElementById('f-status').value === 'Resolved' && !resDescField.value.trim() && agentLines.length) {
    resDescField.value = agentLines.join(' — ');
  }

  // Member Identifier — only if a clear standalone number (6–12 digits) appears
  const identifierField = document.getElementById('f-identifier');
  if (!identifierField.value.trim()) {
    const match = allMemberText.match(/\b\d{6,12}\b/);
    if (match) identifierField.value = match[0];
  }

  alert('Suggested fields filled in from the conversation — please review before saving, especially Issue Type and Member Identifier.');
};

function closeModal() {
  document.getElementById('ticket-overlay').classList.remove('open');
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
      await updateDoc(doc(db, 'tickets', editingId), data);
    } else {
      data.ticketId  = genTicketId();
      data.createdBy = currentUser.email;
      data.createdAt = serverTimestamp();
      data.source    = 'manual';
      await addDoc(collection(db, 'tickets'), data);
    }
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
    alert('Only supervisors can delete tickets.');
    return;
  }
  if (!confirm('Permanently delete this ticket? This cannot be undone.')) return;
  try {
    await deleteDoc(doc(db, 'tickets', editingId));
    closeModal();
  } catch (e) {
    alert('Error deleting: ' + e.message);
  }
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
  const suggestedReply = `Thank you for contacting the Polmed Connect Helpdesk. Your ticket reference is ${t.ticketId}. We will follow up with you shortly.`;
  document.getElementById('detail-body').innerHTML = `
    <div class="detail-grid">
      <div class="detail-item"><label>Contact Method</label><span>${t.contactMethod || '—'}</span></div>
      <div class="detail-item"><label>Member Identifier</label><span>${t.identifier || '—'}</span></div>
      <div class="detail-item"><label>Issue Type</label><span>${t.issueType || '—'}</span></div>
      <div class="detail-item"><label>Status</label><span>${statusBadge(t.status)}</span></div>
      <div class="detail-item"><label>Date Received</label><span>${t.dateReceived || '—'}</span></div>
      <div class="detail-item"><label>Time Received</label><span>${t.timeReceived || '—'}</span></div>
      <div class="detail-item"><label>Source</label><span>${sourceLabel}</span></div>
      <div class="detail-item"><label>Time to First Response</label><span>${t.timeToFirstResponse || '—'}</span></div>
      <div class="detail-item"><label>Resolution Time</label><span>${t.resolutionTime || '—'}</span></div>
      <div class="detail-item"><label>RT (hours)</label><span>${t.rtInHours ?? '—'}</span></div>
      <div class="detail-item"><label>Logged by</label><span>${t.createdBy || '—'}</span></div>
      <div class="detail-item"><label>Last updated by</label><span>${t.updatedBy || '—'}</span></div>
    </div>
    <div class="detail-section">
      <div class="detail-section-label">Original message</div>
      <div class="detail-block">${t.message || '—'}</div>
    </div>
    ${t.mediaUrl ? `
    <div class="detail-section">
      <div class="detail-section-label">Attachment</div>
      ${t.mediaType === 'image'
        ? `<img src="${t.mediaUrl}" alt="Attachment from member" style="max-width:100%;border-radius:8px;border:1px solid #ddd">`
        : `<a href="${t.mediaUrl}" target="_blank" rel="noopener" class="btn btn-sm">Open ${t.mediaType || 'file'}</a>`}
    </div>` : ''}
    ${canReplyByWhatsApp ? `
    <div class="detail-section">
      <div class="detail-section-label">Conversation</div>
      <div id="conversation-thread" class="conversation-thread"></div>
    </div>` : ''}
    <div class="detail-section">
      <div class="detail-section-label">Description</div>
      <div class="detail-block">${t.description || '—'}</div>
    </div>
    ${t.resolutionDescription ? `<div class="detail-section"><div class="detail-section-label">Resolution Notes</div><div class="detail-block">${t.resolutionDescription}</div></div>` : ''}
    ${canReplyByWhatsApp ? `
    <div class="detail-section">
      <div class="detail-section-label">Reply to member (WhatsApp)</div>
      <textarea id="detail-reply-text" rows="3"
        style="width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid #ddd;font:inherit;resize:vertical"
      >${suggestedReply}</textarea>
    </div>` : ''}
  `;
  document.getElementById('copy-reply-btn').style.display = t.ticketId ? 'inline-flex' : 'none';
  document.getElementById('send-reply-btn').style.display = canReplyByWhatsApp ? 'inline-flex' : 'none';
  document.getElementById('detail-overlay').classList.add('open');
  if (canReplyByWhatsApp) renderConversation(id);

  // Mark as read — clears the unread badge now that the agent has opened it
  if (t.hasNewReply) {
    updateDoc(doc(db, 'tickets', id), { hasNewReply: false }).catch(() => {});
  }
}

// ── Conversation thread (WhatsApp back-and-forth) ───────────────────────────
function renderConversation(id) {
  const el = document.getElementById('conversation-thread');
  if (!el) return; // modal isn't showing the thread (not a WhatsApp ticket) — nothing to do
  const t = tickets.find(x => x.id === id);
  if (!t) return;

  const convo = Array.isArray(t.conversation) ? t.conversation : [];
  if (convo.length === 0) {
    el.innerHTML = `<div class="detail-block" style="color:#888">No messages yet beyond the original one above.</div>`;
    return;
  }

  const sorted = [...convo].sort((a, b) => new Date(a.at) - new Date(b.at));
  el.innerHTML = sorted.map(entry => {
    const isAgent = entry.from === 'agent';
    const when = entry.at ? new Date(entry.at).toLocaleString() : '';
    const mediaHtml = entry.mediaUrl
      ? (entry.mediaType === 'image'
          ? `<img src="${entry.mediaUrl}" alt="attachment" style="max-width:200px;border-radius:6px;display:block;margin-top:6px">`
          : `<a href="${entry.mediaUrl}" target="_blank" rel="noopener">Open attachment</a>`)
      : '';
    return `
      <div class="convo-bubble ${isAgent ? 'convo-agent' : 'convo-member'}">
        <div class="convo-meta">${isAgent ? 'You (agent)' : 'Member'} · ${when}</div>
        <div class="convo-text">${(entry.text || '').replace(/</g, '&lt;')}</div>
        ${mediaHtml}
      </div>
    `;
  }).join('');

  // Keep the thread scrolled to the latest message
  el.scrollTop = el.scrollHeight;
}

function closeDetail()    { document.getElementById('detail-overlay').classList.remove('open'); }
function editFromDetail() { closeDetail(); editTicketById(editingId); }

window.copyReply = function () {
  const t = tickets.find(x => x.id === editingId);
  if (!t || !t.ticketId) return;
  const reply = `Thank you for contacting the Polmed Connect Helpdesk. Your ticket reference is ${t.ticketId}. We will follow up with you shortly.`;
  navigator.clipboard.writeText(reply)
    .then(() => alert('Reference reply copied to clipboard.'))
    .catch(() => alert('Copy failed. Please try again.'));
};

window.sendWhatsAppReply = async function () {
  const t = tickets.find(x => x.id === editingId);
  if (!t || !t.phoneNumber) return;
  const textarea = document.getElementById('detail-reply-text');
  const message  = (textarea?.value || '').trim();
  if (!message) { alert('Reply text is empty.'); return; }

  const btn = document.getElementById('send-reply-btn');
  const originalLabel = btn.textContent;
  btn.disabled    = true;
  btn.textContent = 'Sending…';
  try {
    const res = await fetch('/.netlify/functions/send-whatsapp-reply', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticketId:    t.ticketId,
        phoneNumber: t.phoneNumber,
        message
      })
    });
    const result = await res.json();
    if (!res.ok || !result.ok) {
      throw new Error(result?.error?.error?.message || 'Send failed. Note: WhatsApp only allows free-form replies within 24 hours of the member\'s last message — after that, only a pre-approved template can be sent.');
    }
    alert('Reply sent to the member on WhatsApp.');
  } catch (e) {
    alert('Error sending WhatsApp reply: ' + e.message);
  }
  btn.disabled    = false;
  btn.textContent = originalLabel;
};

// ── Sign out ──────────────────────────────────────────────────────────────────
async function signOut() {
  try { await fbSignOut(auth); } catch { /* ignore */ }
  localStorage.removeItem('testUser');
  localStorage.removeItem('polmedDemoMode');
  localStorage.removeItem('polmedDemoEmail');
  localStorage.removeItem('polmedDemoRole');
  window.location.href = 'index.html';
}

// ── Badges / icons ────────────────────────────────────────────────────────────
function statusBadge(s) {
  const map = { 'New': 'new', 'Resolved': 'res', 'In Progress': 'prog', 'Unresolved': 'unres' };
  return `<span class="badge ${map[s] || ''}">${s || '—'}</span>`;
}
function contactIcon(c) {
  return { 'WhatsApp': '📱', 'Email': '📧', 'Phone call': '📞' }[c] || '';
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

  // KPIs
  const total      = subset.length;
  const resolved   = subset.filter(t => t.status === 'Resolved').length;
  const rtValues   = subset.filter(t => t.rtInHours > 0 && t.status === 'Resolved')
                           .map(t => t.rtInHours);
  const avgRT      = rtValues.length
    ? (rtValues.reduce((a, b) => a + b, 0) / rtValues.length).toFixed(1)
    : '—';
  const resRate    = total ? Math.round((resolved / total) * 100) : 0;
  const waCount    = subset.filter(t => t.contactMethod === 'WhatsApp').length;
  const emCount    = subset.filter(t => t.contactMethod === 'Email').length;
  const phCount    = subset.filter(t => t.contactMethod === 'Phone call').length;

  document.getElementById('r-total').textContent   = total;
  document.getElementById('r-avg-rt').textContent  = avgRT === '—' ? '—' : avgRT + ' hrs';
  document.getElementById('r-rate').textContent    = total ? resRate + '%' : '—';
  document.getElementById('r-wa').textContent      = waCount;
  document.getElementById('r-email').textContent   = emCount;
  document.getElementById('r-phone').textContent   = phCount;

  // Monthly bar chart (last 6 months)
  renderMonthlyChart(subset);

  // Issue type breakdown
  renderIssueChart(subset);

  // Status breakdown
  renderStatusChart(subset);
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
    const label = d.toLocaleString('default', { month: 'short', year: '2-digit' });
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
        <div class="vbar-label">${m.label}</div>
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
        <div class="hbar-label" title="${label}">${label}</div>
        <div class="hbar-track">
          <div class="hbar-fill" style="width:${(val/maxVal*100).toFixed(0)}%;background:${colors[i % colors.length]}"></div>
        </div>
        <div class="hbar-val">${val}</div>
      </div>`).join('')
    : '<p class="chart-empty">No data for this period</p>';
}

function renderStatusChart(subset) {
  const total   = subset.length || 1;
  const statuses = [
    { label: 'New',         key: 'New',         color: '#8B5CF6' },
    { label: 'In Progress', key: 'In Progress',  color: '#3B82F6' },
    { label: 'Resolved',    key: 'Resolved',     color: '#10B981' },
    { label: 'Unresolved',  key: 'Unresolved',   color: '#EF4444' },
  ];
  document.getElementById('status-chart').innerHTML =
    statuses.map(s => {
      const val = subset.filter(t => t.status === s.key).length;
      const pct = ((val / total) * 100).toFixed(0);
      return `
        <div class="hbar-row">
          <div class="hbar-label">${s.label}</div>
          <div class="hbar-track">
            <div class="hbar-fill" style="width:${pct}%;background:${s.color}"></div>
          </div>
          <div class="hbar-val">${val} <span class="hbar-pct">${pct}%</span></div>
        </div>`;
    }).join('');
}

function updateReportPeriod() { renderReports(); }