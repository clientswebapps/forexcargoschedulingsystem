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
import { renderStaffActivity }  from './pages/staff-activity.js';
import { renderPrint }         from './pages/print.js';
import { Users, Notifications, ActivityLog } from './db.js';
import { initPresence, stopPresence, updatePresenceRoute } from './presence.js';
import { initPWA, promptInstallApp, updateDownloadAppButtons } from './pwa.js';
import { showToast, showModal, closeModal, initials, roleLabel, icons, escapeHtml } from './utils.js';

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

// Initialize PWA Service Worker & Install Listeners immediately on page load
initPWA();

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

    state.actualRole = userData.role;
    state.user = { ...userData, displayName: authUser.displayName || userData.displayName, actualRole: userData.role };
    showApp();
  } catch (err) {
    console.error('Failed to load user data:', err);
    await firebase.auth().signOut();
    showLoginScreen('Failed to load your account. Please try again.');
  }
});

/* ── Screen switching ───────────────────────────────────── */
function showLoginScreen(message) {
  if (state.cleanup && typeof state.cleanup === 'function') {
    try { state.cleanup(); } catch(_) {}
    state.cleanup = null;
  }
  if (notifBadgeUnsub) {
    try { notifBadgeUnsub(); } catch(_) {}
    notifBadgeUnsub = null;
  }
  if (hashChangeHandler) {
    window.removeEventListener('hashchange', hashChangeHandler);
    hashChangeHandler = null;
  }
  state.uid  = null;
  state.user = null;
  state.authUser = null;
  state.actualRole = null;
  state.simulatedRole = null;

  document.getElementById('topbar-view-as')?.classList.add('hidden');
  document.getElementById('role-preview-bar')?.classList.add('hidden');

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

  window._appState = state;
  buildNav();
  updateUserInfo();
  setupTopbar();
  setupRolePreview();
  setupMobileNav();
  setupSidebarToggle();
  refreshNotifBadge();
  initPresence(state.uid);
  updateDownloadAppButtons();

  try {
    ActivityLog.write({ action: 'USER_LOGIN', details: { email: state.user?.email || state.authUser?.email } });
  } catch (_) {}

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

let currentRouteToken = 0;

async function handleRoute(hash) {
  const routeToken = ++currentRouteToken;

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
  const adminOfficeRoutes = ['/users', '/activity-log', '/staff-activity'];
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
  if (base === '/users' && role !== 'admin' && role !== 'super_admin') {
    navigate('/');
    return;
  }
  if (base === '/staff-activity' && role !== 'super_admin') {
    navigate('/');
    return;
  }

  updatePresenceRoute(location.hash || '#/');

  let title = 'Dashboard';
  let cleanupPromiseOrFn = null;

  if (path === '/' || path === '/dashboard' || path === '') {
    title = 'Dashboard';
    cleanupPromiseOrFn = renderDashboard($content, state);
  } else if (path === '/schedules' || path === '/bookings') {
    title = 'Schedules';
    cleanupPromiseOrFn = renderBookings($content, state);
  } else if (path === '/schedules/new' || path === '/bookings/new') {
    title = 'Create Schedule';
    cleanupPromiseOrFn = renderBookingForm($content, state, null);
  } else if ((segments[0] === 'schedules' || segments[0] === 'bookings') && segments[1] === 'edit' && segments[2]) {
    title = 'Edit Schedule';
    cleanupPromiseOrFn = renderBookingForm($content, state, segments[2]);
  } else if ((segments[0] === 'schedules' || segments[0] === 'bookings') && segments[1] === 'view' && segments[2]) {
    title = 'Schedule Detail';
    cleanupPromiseOrFn = renderBookingDetail($content, state, segments[2]);
  } else if (path === '/my-schedule') {
    title = 'My Schedule';
    cleanupPromiseOrFn = renderMySchedule($content, state);
  } else if (path === '/customers') {
    title = 'Customers';
    cleanupPromiseOrFn = renderCustomers($content, state);
  } else if (path === '/users') {
    title = 'User Management';
    cleanupPromiseOrFn = renderUsers($content, state);
  } else if (path === '/notifications') {
    title = 'Notifications';
    cleanupPromiseOrFn = renderNotifications($content, state);
  } else if (path === '/activity-log') {
    title = 'Activity Log';
    cleanupPromiseOrFn = renderActivityLog($content, state);
  } else if (path === '/staff-activity') {
    title = 'Staff Activity & Live Presence';
    cleanupPromiseOrFn = renderStaffActivity($content, state);
  } else if (path === '/print') {
    title = 'Print Schedule';
    cleanupPromiseOrFn = renderPrint($content, state, query || '');
  } else {
    // 404 — redirect to home
    navigate('/');
    return;
  }

  const cleanupFn = cleanupPromiseOrFn instanceof Promise ? await cleanupPromiseOrFn : cleanupPromiseOrFn;

  // If user navigated elsewhere before this page finished resolving, immediately clean up
  if (routeToken !== currentRouteToken) {
    if (typeof cleanupFn === 'function') {
      try { cleanupFn(); } catch (_) {}
    }
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
        <button class="nav-item" data-route="${item.route}" title="${escapeHtml(item.label)}" onclick="window._navigate('${item.route}')">
          <span class="nav-icon">${item.icon}</span>
          <span>${escapeHtml(item.label)}</span>
        </button>
      </li>`;
  }).join('');

  // Download App, Change Email, Change Password (admin only), and Logout at bottom
  const footer = document.getElementById('sidebar-footer');
  const canManageCredentials = role === 'admin' || role === 'super_admin';
  if (footer) {
    footer.innerHTML = `
      <button class="nav-item download-app-btn" id="download-app-nav-btn" title="Download / Install App" style="color:#64B5F6;margin-bottom:2px;font-weight:500;">
        <span class="nav-icon">${icons.download}</span>
        <span>Download App</span>
      </button>
      ${canManageCredentials ? `
      <button class="nav-item" id="change-email-nav-btn" title="Change Email" style="color:rgba(255,255,255,0.75);margin-bottom:2px;">
        <span class="nav-icon">${icons.mail}</span>
        <span>Change Email</span>
      </button>
      <button class="nav-item" id="change-pwd-nav-btn" title="Change Password" style="color:rgba(255,255,255,0.75);margin-bottom:2px;">
        <span class="nav-icon">${icons.key}</span>
        <span>Change Password</span>
      </button>` : ''}
      <button class="nav-item" id="logout-nav-btn" title="Sign Out" style="color:rgba(255,255,255,0.6)">
        <span class="nav-icon">${icons.logout}</span>
        <span>Sign Out</span>
      </button>`;
    footer.querySelector('#download-app-nav-btn')?.addEventListener('click', promptInstallApp);
    footer.querySelector('#change-email-nav-btn')?.addEventListener('click', showChangeEmailModal);
    footer.querySelector('#change-pwd-nav-btn')?.addEventListener('click', showChangePasswordModal);
    footer.querySelector('#logout-nav-btn')?.addEventListener('click', signOut);

    updateDownloadAppButtons();
  }
}

function getNavItems(role) {
  if (role === 'salesperson') {
    return [
      { route: '/',              label: 'Dashboard',    icon: icons.dashboard },
      { route: '/my-schedule',   label: 'My Schedule',  icon: icons.schedule  },
      { route: '/customers',     label: 'Customers',    icon: icons.customers },
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

  if (role === 'admin' || role === 'super_admin') {
    items.splice(3, 0, { route: '/users', label: 'Users', icon: icons.users });
  }

  if (role === 'super_admin') {
    items.splice(4, 0, { route: '/staff-activity', label: 'Staff Activity', icon: icons.activity });
  }

  return items;
}

/* ── User info in sidebar ───────────────────────────────── */
function updateUserInfo() {
  if ($userAvatar) $userAvatar.textContent = initials(state.user.displayName);
  if ($userName)   $userName.textContent   = state.user.displayName || state.authUser.email;
  if ($userRole) {
    if (state.simulatedRole) {
      $userRole.innerHTML = `<span style="color:#BA68C8;font-weight:700;">${roleLabel(state.user.role)} (Preview)</span>`;
    } else {
      $userRole.textContent = roleLabel(state.user.role);
    }
  }

  const userCard = document.querySelector('.sidebar-user');
  if (userCard && !userCard._bound) {
    userCard._bound = true;
    userCard.setAttribute('title', 'Click to edit your display name');
    userCard.addEventListener('click', showChangeNameModal);
  }
}

/* ── Super Admin Role Preview (View As Simulator) ────────── */
function setupRolePreview() {
  const isSuper = state.actualRole === 'super_admin' || state.user?.actualRole === 'super_admin';
  const topbarViewAs = document.getElementById('topbar-view-as');
  const topbarSelect = document.getElementById('topbar-view-as-select');
  const previewBar = document.getElementById('role-preview-bar');
  const previewSelect = document.getElementById('preview-role-select');
  const exitBtn = document.getElementById('exit-preview-btn');

  if (!isSuper) {
    if (topbarViewAs) topbarViewAs.classList.add('hidden');
    if (previewBar) previewBar.classList.add('hidden');
    return;
  }

  // Show topbar selector for Super Admin
  if (topbarViewAs) topbarViewAs.classList.remove('hidden');

  const onSelectChange = (e) => {
    setRolePreview(e.target.value);
  };

  if (topbarSelect && !topbarSelect._bound) {
    topbarSelect._bound = true;
    topbarSelect.addEventListener('change', onSelectChange);
  }

  if (previewSelect && !previewSelect._bound) {
    previewSelect._bound = true;
    previewSelect.addEventListener('change', onSelectChange);
  }

  if (exitBtn && !exitBtn._bound) {
    exitBtn._bound = true;
    exitBtn.addEventListener('click', () => setRolePreview('super_admin'));
  }
}

function setRolePreview(simulatedRole) {
  const isSuper = state.actualRole === 'super_admin' || state.user?.actualRole === 'super_admin';
  if (!isSuper) return;

  const topbarSelect = document.getElementById('topbar-view-as-select');
  const previewBar = document.getElementById('role-preview-bar');
  const previewLabel = document.getElementById('preview-role-label');
  const previewSelect = document.getElementById('preview-role-select');

  if (simulatedRole === 'super_admin' || !simulatedRole) {
    state.user.role = 'super_admin';
    state.simulatedRole = null;
    if (previewBar) previewBar.classList.add('hidden');
    showToast('Exited Preview Mode. Returned to Super Admin view.', 'info');
  } else {
    state.user.role = simulatedRole;
    state.simulatedRole = simulatedRole;
    if (previewLabel) previewLabel.textContent = roleLabel(simulatedRole);
    if (previewBar) previewBar.classList.remove('hidden');
    showToast(`👁️ Previewing as ${roleLabel(simulatedRole)}. You remain completely hidden from regular users.`, 'info');
  }

  const currentVal = state.simulatedRole || 'super_admin';
  if (topbarSelect) topbarSelect.value = currentVal;
  if (previewSelect) previewSelect.value = currentVal;

  buildNav();
  updateUserInfo();

  // Route check
  const currentBase = '/' + (location.hash.replace(/^#\/?/, '').split('/')[0] || '');
  if (state.user.role === 'salesperson') {
    const adminOfficeRoutes = ['/users', '/activity-log', '/staff-activity'];
    if (adminOfficeRoutes.includes(currentBase) || currentBase === '/schedules') {
      navigate('/my-schedule');
      return;
    }
  } else if (state.user.role !== 'super_admin' && currentBase === '/staff-activity') {
    navigate('/');
    return;
  } else if (state.user.role === 'office_staff' && currentBase === '/users') {
    navigate('/');
    return;
  }

  handleRoute(location.hash || '#/');
}

/* ── Topbar setup ───────────────────────────────────────── */
function setupTopbar() {
  document.getElementById('topbar-download-btn')?.addEventListener('click', promptInstallApp);
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

/* ── Collapsible Mini-Sidebar Toggle ────────────────────── */
function setupSidebarToggle() {
  const isCollapsed = localStorage.getItem('sidebar_collapsed') === 'true';
  if (isCollapsed) {
    $appShell.classList.add('sidebar-collapsed');
  }

  const toggleSidebar = () => {
    const collapsed = $appShell.classList.toggle('sidebar-collapsed');
    localStorage.setItem('sidebar_collapsed', collapsed ? 'true' : 'false');
  };

  const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
  if (sidebarToggleBtn && !sidebarToggleBtn._bound) {
    sidebarToggleBtn._bound = true;
    sidebarToggleBtn.addEventListener('click', toggleSidebar);
  }

  const sidebarEdgeToggleBtn = document.getElementById('sidebar-edge-toggle-btn');
  if (sidebarEdgeToggleBtn && !sidebarEdgeToggleBtn._bound) {
    sidebarEdgeToggleBtn._bound = true;
    sidebarEdgeToggleBtn.addEventListener('click', toggleSidebar);
  }

  const topbarToggleBtn = document.getElementById('topbar-sidebar-toggle-btn');
  if (topbarToggleBtn && !topbarToggleBtn._bound) {
    topbarToggleBtn._bound = true;
    topbarToggleBtn.addEventListener('click', toggleSidebar);
  }
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
    try {
      await ActivityLog.write({ action: 'USER_LOGOUT', details: { email: state.user?.email || state.authUser?.email } });
    } catch (_) {}
    await stopPresence();
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

/* ── Change Password Modal ──────────────────────────────── */
function showChangePasswordModal() {
  showModal({
    title: 'Change Password',
    body: `
      <div class="form-group">
        <label class="form-label required" for="cp-current">Current Password</label>
        <input type="password" id="cp-current" class="form-control" placeholder="Enter current password" autocomplete="current-password">
      </div>
      <div class="form-group">
        <label class="form-label required" for="cp-new">New Password</label>
        <input type="password" id="cp-new" class="form-control" placeholder="Minimum 8 characters" autocomplete="new-password">
      </div>
      <div class="form-group">
        <label class="form-label required" for="cp-confirm">Confirm New Password</label>
        <input type="password" id="cp-confirm" class="form-control" placeholder="Re-enter new password" autocomplete="new-password">
      </div>
      <div id="cp-err" class="form-error hidden"></div>`,
    confirmText: 'Update Password',
    cancelText: 'Cancel',
    onConfirm: async () => {
      const currentPass = document.getElementById('cp-current').value;
      const newPass     = document.getElementById('cp-new').value;
      const confirmPass = document.getElementById('cp-confirm').value;
      const errEl       = document.getElementById('cp-err');

      if (!currentPass) {
        errEl.textContent = 'Current password is required.';
        errEl.classList.remove('hidden');
        throw new Error('validation');
      }
      if (!newPass) {
        errEl.textContent = 'New password is required.';
        errEl.classList.remove('hidden');
        throw new Error('validation');
      }
      if (newPass.length < 8) {
        errEl.textContent = 'New password must be at least 8 characters long.';
        errEl.classList.remove('hidden');
        throw new Error('validation');
      }
      if (newPass !== confirmPass) {
        errEl.textContent = 'New passwords do not match.';
        errEl.classList.remove('hidden');
        throw new Error('validation');
      }
      if (currentPass === newPass) {
        errEl.textContent = 'New password must be different from current password.';
        errEl.classList.remove('hidden');
        throw new Error('validation');
      }

      errEl.classList.add('hidden');

      const user = firebase.auth().currentUser;
      if (!user || !user.email) {
        errEl.textContent = 'You must be signed in to change your password.';
        errEl.classList.remove('hidden');
        throw new Error('not_authenticated');
      }

      try {
        const credential = firebase.auth.EmailAuthProvider.credential(user.email, currentPass);
        await user.reauthenticateWithCredential(credential);
        await user.updatePassword(newPass);
        try {
          await ActivityLog.write({
            action: 'PASSWORD_CHANGED',
            details: { email: user.email }
          });
        } catch (_) {}
        showToast('Password updated successfully.', 'success');
      } catch (err) {
        console.error('Password change error:', err);
        const msgs = {
          'auth/wrong-password': 'The current password you entered is incorrect.',
          'auth/invalid-credential': 'The current password you entered is incorrect.',
          'auth/weak-password': 'The new password is too weak. Please use a stronger password.',
          'auth/too-many-requests': 'Too many unsuccessful attempts. Please try again later.',
          'auth/requires-recent-login': 'Please sign out and sign in again before changing your password.',
        };
        errEl.textContent = msgs[err.code] || err.message || 'Failed to change password.';
        errEl.classList.remove('hidden');
        throw err;
      }
    }
  });
}

/* ── Change Email Modal ─────────────────────────────────── */
function showChangeEmailModal() {
  showModal({
    title: 'Change Email Address',
    body: `
      <div class="form-group">
        <label class="form-label" for="ce-current-email">Current Email</label>
        <input type="email" id="ce-current-email" class="form-control form-control-readonly" value="${escapeHtml(state.user?.email || '')}" readonly>
      </div>
      <div class="form-group">
        <label class="form-label required" for="ce-new-email">New Email Address</label>
        <input type="email" id="ce-new-email" class="form-control" placeholder="new-email@forexcargo.bh" autocomplete="email">
      </div>
      <div class="form-group">
        <label class="form-label required" for="ce-password">Current Password (to confirm)</label>
        <input type="password" id="ce-password" class="form-control" placeholder="Enter current password" autocomplete="current-password">
      </div>
      <div class="text-xs text-secondary mt-1" style="line-height:1.4">
        Firebase will send a verification link to your new email address to confirm the change.
      </div>
      <div id="ce-err" class="form-error hidden mt-2"></div>`,
    confirmText: 'Send Verification Email',
    cancelText: 'Cancel',
    onConfirm: async () => {
      const newEmail    = (document.getElementById('ce-new-email').value || '').trim();
      const currentPass = document.getElementById('ce-password').value;
      const errEl       = document.getElementById('ce-err');

      if (!newEmail) {
        errEl.textContent = 'New email address is required.';
        errEl.classList.remove('hidden');
        throw new Error('validation');
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
        errEl.textContent = 'Please enter a valid email address.';
        errEl.classList.remove('hidden');
        throw new Error('validation');
      }
      if (newEmail.toLowerCase() === (state.user?.email || '').toLowerCase()) {
        errEl.textContent = 'New email must be different from current email.';
        errEl.classList.remove('hidden');
        throw new Error('validation');
      }
      if (!currentPass) {
        errEl.textContent = 'Current password is required to change email.';
        errEl.classList.remove('hidden');
        throw new Error('validation');
      }

      errEl.classList.add('hidden');

      const user = firebase.auth().currentUser;
      if (!user) {
        errEl.textContent = 'You must be signed in.';
        errEl.classList.remove('hidden');
        throw new Error('not_authenticated');
      }

      try {
        const credential = firebase.auth.EmailAuthProvider.credential(user.email, currentPass);
        await user.reauthenticateWithCredential(credential);

        if (typeof user.verifyBeforeUpdateEmail === 'function') {
          await user.verifyBeforeUpdateEmail(newEmail);
          try {
            await ActivityLog.write({
              action: 'EMAIL_CHANGED',
              details: { oldEmail: state.user.email, newEmail, status: 'Verification Link Sent' }
            });
          } catch (_) {}
          showToast(`Verification email sent to ${newEmail}! Click the link in your inbox to confirm.`, 'info');
        } else {
          await user.updateEmail(newEmail);
          await Users.update(user.uid, { email: newEmail });
          try {
            await ActivityLog.write({
              action: 'EMAIL_CHANGED',
              details: { oldEmail: state.user.email, newEmail }
            });
          } catch (_) {}
          state.user.email = newEmail;
          updateUserInfo();
          showToast('Email address updated successfully.', 'success');
        }
      } catch (err) {
        console.error('Email change error:', err);
        const msgs = {
          'auth/wrong-password': 'The password you entered is incorrect.',
          'auth/invalid-credential': 'The password you entered is incorrect.',
          'auth/email-already-in-use': 'This email address is already in use by another account.',
          'auth/invalid-email': 'The email address format is invalid.',
          'auth/requires-recent-login': 'Please sign out and sign back in before changing your email.',
          'auth/operation-not-allowed': 'Email verification is required by Firebase security settings. Please check your inbox.',
        };
        errEl.textContent = msgs[err.code] || err.message || 'Failed to update email.';
        errEl.classList.remove('hidden');
        throw err;
      }
    }
  });
}

/* ── Change Display Name Modal ──────────────────────────── */
function showChangeNameModal() {
  showModal({
    title: 'Change Display Name',
    body: `
      <div class="form-group">
        <label class="form-label required" for="cn-name">Display Name</label>
        <input type="text" id="cn-name" class="form-control" value="${escapeHtml(state.user?.displayName || '')}" placeholder="Full Name" autocomplete="name">
      </div>
      <div id="cn-err" class="form-error hidden"></div>`,
    confirmText: 'Save Name',
    cancelText: 'Cancel',
    onConfirm: async () => {
      const newName = (document.getElementById('cn-name').value || '').trim();
      const errEl   = document.getElementById('cn-err');

      if (!newName) {
        errEl.textContent = 'Display name cannot be empty.';
        errEl.classList.remove('hidden');
        throw new Error('validation');
      }

      errEl.classList.add('hidden');

      const user = firebase.auth().currentUser;
      if (!user) {
        errEl.textContent = 'You must be signed in.';
        errEl.classList.remove('hidden');
        throw new Error('not_authenticated');
      }

      try {
        const oldName = state.user.displayName;
        await user.updateProfile({ displayName: newName });
        await Users.update(user.uid, { displayName: newName });
        try {
          await ActivityLog.write({
            action: 'PROFILE_NAME_CHANGED',
            details: { oldName, newName }
          });
        } catch (_) {}
        state.user.displayName = newName;
        updateUserInfo();
        showToast('Display name updated successfully.', 'success');
      } catch (err) {
        console.error('Name change error:', err);
        errEl.textContent = err.message || 'Failed to update name.';
        errEl.classList.remove('hidden');
        throw err;
      }
    }
  });
}
