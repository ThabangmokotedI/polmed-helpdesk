// app.js — UI helpers for dashboard (navigation, sidebar, keyboard)

const PAGES = ['tickets', 'reports', 'setup', 'guide'];

function setPage(page) {
  PAGES.forEach(p => {
    const el  = document.getElementById(`page-${p}`);
    const nav = document.getElementById(`nav-${p}`);
    if (el)  el.style.display  = p === page ? 'block' : 'none';
    if (nav) nav.classList.toggle('active', p === page);
  });

  const titles = {
    tickets: ['All Tickets',            'Polmed Connect App — Member Support 2026'],
    reports: ['Reporting Dashboard',    'Monthly stats, resolution times, issue breakdown'],
    setup:   ['Setup & Integrations',  'WhatsApp auto-logging · Email-to-ticket · Role management'],
    guide:   ['WhatsApp Workflow',      'How inbound messages become helpdesk tickets'],
  };
  const t = titles[page] || ['', ''];
  document.getElementById('page-title').textContent = t[0];
  document.getElementById('page-sub').textContent   = t[1];

  // Trigger report render when switching to reports
  if (page === 'reports' && window.renderReports) window.renderReports();

  // Close sidebar on mobile after nav
  if (window.innerWidth < 768) {
    document.getElementById('sidebar').classList.remove('open');
  }
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// Close sidebar when clicking outside on mobile
document.addEventListener('click', (e) => {
  const sidebar = document.getElementById('sidebar');
  const toggle  = document.querySelector('.menu-toggle');
  if (window.innerWidth < 768 && sidebar.classList.contains('open')) {
    if (!sidebar.contains(e.target) && !toggle?.contains(e.target)) {
      sidebar.classList.remove('open');
    }
  }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.overlay.open').forEach(o => o.classList.remove('open'));
  }
});
