/**
 * app.js — Main application controller
 * Handles: auth state, routing, navigation, notification badge
 */
'use strict';

import { renderLogin }         from './pages/login.js';
import { renderDashboard }     from './pages/dashboard.js';
import { renderUsers }         from './pages/users.js';
import { renderCustomers }     from './pages/customers.js';
import { renderBookings }      from './pages/bookings.js';
import { renderBookingForm }   from './pages/booking-form.js';
import { renderBookingDetail } from './pages/booking-detail.js';
import { renderMySchedule }    from './pages/my-schedule.js';
import { renderNotifications } from './pages/notifications.js';
import { renderActivityLog }   from './pages/activity-log.js';
import { renderPrint }         from './pages/print.js';
import { Users, Notifications } from './db.js';
import { showToast, initials, roleLabel, icons, escapeHtml } from './utils.js';

/* ── App State ──────────────────────────────────────────── */
const state = {
  uid:  null,
  user: null,       // Firestore user document
  authUser: null,   // Firebase Auth user
};
let hashChangeHandler = null;

/* ── DOM refs ───────────────────────────────────────────── */
const $loading    = document.getElementById('loading-screen');
const $appShell   = document.getElementById('app-shell');
const $loginScreen = document.getElementById('login-screen');
const $content    = document.getElementById('page-content');
const $pageTitle  = document.getElementById('topbar-page-title');
const $navMenu    = document.getElementById('nav-menu');
const $userAvatar = document.getElementById('user-avatar');
const $userName   = document.getElementById('user-display-name');
const $userRole   = document.getElementById('user-role-badge');
const $notifBadge = document.getElementById('notif-badge');
const $sidebar    = document.getElementById('sidebar');
const $sidebarOverlay = document.getElementById('sidebar-overlay');

/* ── Auth State Observer ────────────────────────────────── */
firebase.auth().onAuthStateChanged(async (authUser) => {
  if (!authUser) {
    showLoginScreen();
    return;
  }
  state.authUser = authUser;
  state.uid      = authUser.uid;

  try {
    // Load user document from Firestore
    const userData = await Users.get(authUser.uid);

    if (!userData) {
      // User exists in Auth but not in Firestore — not provisioned
      await firebase.auth().signOut();
      showLoginScreen('Your account has not been set up yet. Please contact your administrator.');
      return;
    }

    if (!userData.isActive) {
      await firebase.auth().signOut();
      showLoginScreen('Your account has been deactivated. Please contact your administrator.');
      return;
    }

    state.user = { ...userData, displayName: authUser.displayName || userData.displayName };
    showApp();
  } catch (err) {
    console.error('Failed to load user data:', err);
    await firebase.auth().signOut();
    showLoginScreen('Failed to load your account. Please try again.');
  }
});

/* ── Screen switching ───────────────────────────────────── */
function showLoginScreen(message) {
  $loading.classList.add('fade-out');
  setTimeout(() => $loading.classList.add('hidden'), 400);
  $appShell.classList.add('hidden');
  $loginScreen.classList.remove('hidden');
  renderLogin($loginScreen, message);
}

function showApp() {
  $loading.classList.add('fade-out');
  setTimeout(() => $loading.classList.add('hidden'), 400);
  $loginScreen.classList.add('hidden');
  $appShell.classList.remove('hidden');

  buildNav();
  updateUserInfo();
  setupTopbar();
  setupMobileNav();
  refreshNotifBadge();

  // Initial route
  handleRoute(location.hash || '#/');
  hashChangeHandler = () => handleRoute(location.hash);
  window.addEventListener('hashchange', hashChangeHandler);
  window._navigate = navigate;
  window._refreshNotifBadge = refreshNotifBadge;
}

/* ── Navigation ─────────────────────────────────────────── */
function navigate(path) {
  if (path === -1) { history.back(); return; }
  location.hash = '#' + (path.startsWith('/') ? path : '/' + path);
}

function handleRoute(hash) {
  // Clean up any active listeners from previous view
  if (state.cleanup) {
    try {
      if (typeof state.cleanup === 'function') state.cleanup();
    } catch (e) {
      console.error('Route cleanup error:', e);
    }
    state.cleanup = null;
  }

  const raw   = hash.replace(/^#/, '') || '/';
  const [path, query] = raw.split('?');
  const segments = path.split('/').filter(Boolean);
  const base = '/' + (segments[0] || '');

  updateActiveNav(base);

  $content.scrollTop = 0;

  // Route table
  const role = state.user.role;

  // Guard: salesperson cannot access admin/office pages
  const adminOfficeRoutes = ['/customers', '/users', '/activity-log'];
  if (role === 'salesperson') {
    if (adminOfficeRoutes.includes(base)) {
      navigate('/my-schedule');
      return;
    }
    if ((base === '/schedules' || base === '/bookings') && !segments[1]) {
      navigate('/my-schedule');
      return;
    }
  }
  if (base === '/users' && role !== 'admin') {
    navigate('/');
    return;
  }

  let title = 'Dashboard';
  let cleanupFn = null;

  if (path === '/' || path === '/dashboard' || path === '') {
    title = 'Dashboard';
    cleanupFn = renderDashboard($content, state);
  } else if (path === '/schedules' || path === '/bookings') {
    title = 'Schedules';
    cleanupFn = renderBookings($content, state);
  } else if (path === '/schedules/new' || path === '/bookings/new') {
    title = 'Create Schedule';
    cleanupFn = renderBookingForm($content, state, null);
  } else if ((segments[0] === 'schedules' || segments[0] === 'bookings') && segments[1] === 'edit' && segments[2]) {
    title = 'Edit Schedule';
    cleanupFn = renderBookingForm($content, state, segments[2]);
  } else if ((segments[0] === 'schedules' || segments[0] === 'bookings') && segments[1] === 'view' && segments[2]) {
    title = 'Schedule Detail';
    cleanupFn = renderBookingDetail($content, state, segments[2]);
  } else if (path === '/my-schedule') {
    title = 'My Schedule';
    cleanupFn = renderMySchedule($content, state);
  } else if (path === '/customers') {
    title = 'Customers';
    cleanupFn = renderCustomers($content, state);
  } else if (path === '/users') {
    title = 'User Management';
    cleanupFn = renderUsers($content, state);
  } else if (path === '/notifications') {
    title = 'Notifications';
    cleanupFn = renderNotifications($content, state);
  } else if (path === '/activity-log') {
    title = 'Activity Log';
    cleanupFn = renderActivityLog($content, state);
  } else if (path === '/print') {
    title = 'Print Schedule';
    cleanupFn = renderPrint($content, state, query || '');
  } else {
    // 404 — redirect to home
    navigate('/');
    return;
  }

  if (typeof cleanupFn === 'function') {
    state.cleanup = cleanupFn;
  }

  // Update topbar title
  if ($pageTitle) $pageTitle.textContent = title;
}

function updateActiveNav(basePath) {
  $navMenu.querySelectorAll('.nav-item').forEach(el => {
    const href = el.getAttribute('data-route') || '';
    el.classList.toggle('active', href === basePath);
  });
}

/* ── Build navigation menu based on role ────────────────── */
function buildNav() {
  const role = state.user.role;
  const navItems = getNavItems(role);

  $navMenu.innerHTML = navItems.map(item => {
    if (item.divider) return `<li style="height:1px;background:var(--sidebar-border);margin:6px 0;"></li>`;
    return `
      <li>
        <button class="nav-item" data-route="${item.route}" onclick="window._navigate('${item.route}')">
          <span class="nav-icon">${item.icon}</span>
          <span>${escapeHtml(item.label)}</span>
        </button>
      </li>`;
  }).join('');

  // Logout at bottom
  const footer = document.getElementById('sidebar-footer');
  if (footer) {
    footer.innerHTML = `
      <button class="nav-item" id="logout-nav-btn" style="color:rgba(255,255,255,0.6)">
        <span class="nav-icon">${icons.logout}</span>
        <span>Sign Out</span>
      </button>`;
    footer.querySelector('#logout-nav-btn').addEventListener('click', signOut);
  }
}

function getNavItems(role) {
  if (role === 'salesperson') {
    return [
      { route: '/',              label: 'Dashboard',    icon: icons.dashboard },
      { route: '/my-schedule',   label: 'My Schedule',  icon: icons.schedule  },
      { divider: true },
      { route: '/notifications', label: 'Notifications',icon: icons.bell      },
    ];
  }

  const items = [
    { route: '/',              label: 'Dashboard',    icon: icons.dashboard },
    { route: '/schedules',     label: 'Schedules',    icon: icons.bookings  },
    { route: '/customers',     label: 'Customers',    icon: icons.customers },
    { divider: true },
    { route: '/notifications', label: 'Notifications',icon: icons.bell      },
    { route: '/activity-log',  label: 'Activity Log', icon: icons.history   },
  ];

  if (role === 'admin') {
    items.splice(3, 0, { route: '/users', label: 'Users', icon: icons.users });
  }

  return items;
}

/* ── User info in sidebar ───────────────────────────────── */
function updateUserInfo() {
  if ($userAvatar) $userAvatar.textContent = initials(state.user.displayName);
  if ($userName)   $userName.textContent   = state.user.displayName || state.authUser.email;
  if ($userRole)   $userRole.textContent   = roleLabel(state.user.role);
}

/* ── Topbar setup ───────────────────────────────────────── */
function setupTopbar() {
  document.getElementById('logout-btn')?.addEventListener('click', signOut);
  document.getElementById('notifications-btn')?.addEventListener('click', () => navigate('/notifications'));
}

/* ── Mobile nav ─────────────────────────────────────────── */
function setupMobileNav() {
  const menuBtn = document.getElementById('mobile-menu-btn');
  menuBtn?.addEventListener('click', () => {
    $sidebar.classList.toggle('open');
    if ($sidebarOverlay) $sidebarOverlay.style.display = $sidebar.classList.contains('open') ? 'block' : 'none';
  });
  $sidebarOverlay?.addEventListener('click', () => {
    $sidebar.classList.remove('open');
    if ($sidebarOverlay) $sidebarOverlay.style.display = 'none';
  });
  // Close sidebar on nav item click (mobile)
  $navMenu?.addEventListener('click', () => {
    if (window.innerWidth < 768) {
      $sidebar.classList.remove('open');
      if ($sidebarOverlay) $sidebarOverlay.style.display = 'none';
    }
  });
}

/* ── Notification badge ─────────────────────────────────── */
let notifBadgeUnsub = null;

function setupNotifBadgeListener() {
  if (notifBadgeUnsub) notifBadgeUnsub();
  if (!state.uid) return;

  try {
    notifBadgeUnsub = Notifications.onSnapshot(state.uid, (notifs) => {
      const unreadCount = notifs.filter(n => !n.read).length;
      if ($notifBadge) {
        if (unreadCount > 0) {
          $notifBadge.textContent = unreadCount > 99 ? '99+' : unreadCount;
          $notifBadge.classList.remove('hidden');
        } else {
          $notifBadge.classList.add('hidden');
        }
      }
    });
  } catch (_) {}
}

async function refreshNotifBadge() {
  setupNotifBadgeListener();
}

/* ── Sign out ───────────────────────────────────────────── */
async function signOut() {
  try {
    if (state.cleanup && typeof state.cleanup === 'function') {
      try { state.cleanup(); } catch(_) {}
      state.cleanup = null;
    }
    if (notifBadgeUnsub) {
      notifBadgeUnsub();
      notifBadgeUnsub = null;
    }
    await firebase.auth().signOut();
    state.uid  = null;
    state.user = null;
    state.authUser = null;
    location.hash = '';
    if (hashChangeHandler) {
      window.removeEventListener('hashchange', hashChangeHandler);
      hashChangeHandler = null;
    }
  } catch (err) {
    showToast('Failed to sign out.', 'error');
  }
}
