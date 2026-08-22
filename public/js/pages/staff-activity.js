/**
 * staff-activity.js — Super Admin Live Staff Presence & Activity Monitor
 * Real-time presence tracking, heartbeat status, and comprehensive user audit logs.
 */
'use strict';
import { Users, ActivityLog } from '../db.js';
import { getPresenceStatus } from '../presence.js';
import { 
  loadingHTML, errorHTML, escapeHtml, timeAgo, formatDateTime, 
  roleBadge, initials, showModal, debounce, icons 
} from '../utils.js';

export async function renderStaffActivity(container, appState) {
  // Guard: Only Super Admin can access
  if (appState.user.role !== 'super_admin') {
    container.innerHTML = `<div class="card"><div class="card-body">${errorHTML('Access Denied. Super Admin only.')}</div></div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title flex items-center gap-2">
          Staff Activity &amp; Live Presence
          <span class="badge" style="background:#4A148C;color:#fff;font-size:0.7rem;vertical-align:middle;">Super Admin Only</span>
        </h1>
        <div class="page-subtitle">Real-time team presence, active pages, device info, and user audit history</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-secondary btn-sm" id="sa-refresh-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          Refresh
        </button>
      </div>
    </div>

    <!-- Summary Stats -->
    <div class="stats-grid" id="sa-stats">
      ${loadingHTML('Loading presence…')}
    </div>

    <!-- Main Content Tabs -->
    <div class="tabs" style="margin-bottom:16px;">
      <button class="tab-btn active" id="sa-tab-presence">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
        Live Staff Presence (<span id="sa-online-count">0</span> Online)
      </button>
      <button class="tab-btn" id="sa-tab-stream">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        Live Activity Stream
      </button>
    </div>

    <!-- Tab 1: Live Presence View -->
    <div id="sa-view-presence">
      <div class="card">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div class="card-title">Staff Members &amp; Current Status</div>
            <div class="card-subtitle">Real-time presence updates &amp; active screen locations</div>
          </div>
          <div>
            <input type="text" id="sa-presence-search" class="filter-control" placeholder="Search staff name or role…" style="width:220px;">
          </div>
        </div>
        <div id="sa-presence-table">${loadingHTML()}</div>
      </div>
    </div>

    <!-- Tab 2: Live Activity Stream View -->
    <div id="sa-view-stream" class="hidden">
      <div class="filter-bar">
        <div class="filter-row">
          <div class="filter-group" style="flex:2;min-width:160px;">
            <div class="filter-label">Search Activity</div>
            <input type="text" id="sa-log-search" class="filter-control" placeholder="Search by staff, action, or details…">
          </div>
          <div class="filter-group">
            <div class="filter-label">Staff Member</div>
            <select id="sa-log-user" class="filter-control">
              <option value="">All Staff</option>
            </select>
          </div>
          <div class="filter-group">
            <div class="filter-label">Action Category</div>
            <select id="sa-log-action" class="filter-control">
              <option value="">All Categories</option>
              <option value="AUTH">Logins &amp; Sessions</option>
              <option value="BOOKING">Schedules &amp; Bookings</option>
              <option value="CUSTOMER">Customers</option>
              <option value="USER">User Account Management</option>
              <option value="PROFILE">Profile &amp; Password</option>
            </select>
          </div>
          <div class="filter-actions">
            <button class="btn btn-secondary btn-sm" id="sa-log-clear">Clear</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header" id="sa-log-count-header">
          <div class="card-title">Live Audit Stream</div>
        </div>
        <div id="sa-stream-content">${loadingHTML()}</div>
      </div>
    </div>
  `;

  let allUsers = [];
  let allLogs = [];
  let unsubUsers = null;
  let unsubLogs = null;
  let activeTab = 'presence';

  // Tab switching
  const tabPresence = document.getElementById('sa-tab-presence');
  const tabStream   = document.getElementById('sa-tab-stream');
  const viewPresence = document.getElementById('sa-view-presence');
  const viewStream   = document.getElementById('sa-view-stream');

  tabPresence.addEventListener('click', () => {
    activeTab = 'presence';
    tabPresence.classList.add('active');
    tabStream.classList.remove('active');
    viewPresence.classList.remove('hidden');
    viewStream.classList.add('hidden');
  });

  tabStream.addEventListener('click', () => {
    activeTab = 'stream';
    tabStream.classList.add('active');
    tabPresence.classList.remove('active');
    viewStream.classList.remove('hidden');
    viewPresence.classList.add('hidden');
  });

  // 1. Subscribe to all users in real-time
  function subscribeUsers() {
    if (unsubUsers) unsubUsers();
    unsubUsers = Users.onSnapshot(usersList => {
      allUsers = usersList;
      updatePresenceStats();
      renderPresenceTable();
      populateStaffFilter();
    });
  }

  // 2. Subscribe to Activity Log in real-time
  function subscribeLogs() {
    if (unsubLogs) unsubLogs();
    unsubLogs = ActivityLog.onSnapshot({}, logsList => {
      allLogs = logsList;
      renderLogStream();
      updatePresenceStats();
    });
  }

  // Calculate and render stats cards
  function updatePresenceStats() {
    const statsEl = document.getElementById('sa-stats');
    if (!statsEl) return;

    let onlineCount = 0;
    let idleCount   = 0;
    let offlineCount = 0;

    allUsers.forEach(u => {
      const p = getPresenceStatus(u);
      if (p.status === 'online') onlineCount++;
      else if (p.status === 'idle') idleCount++;
      else offlineCount++;
    });

    const onlineBadge = document.getElementById('sa-online-count');
    if (onlineBadge) onlineBadge.textContent = onlineCount;

    // Count today's activities
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayLogsCount = allLogs.filter(l => {
      const ts = l.timestamp?.toDate ? l.timestamp.toDate() : new Date(l.timestamp);
      return ts >= today;
    }).length;

    statsEl.innerHTML = `
      <div class="stat-card">
        <div class="stat-icon green" style="background:rgba(46,125,50,0.12);color:#2E7D32;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>
        </div>
        <div class="stat-info">
          <div class="stat-value" style="color:#2E7D32;">
            <span class="presence-pulse-dot" style="display:inline-block;width:10px;height:10px;background:#2E7D32;border-radius:50%;margin-right:6px;box-shadow:0 0 0 rgba(46,125,50,0.4);animation:presencePulse 1.8s infinite;"></span>
            ${onlineCount}
          </div>
          <div class="stat-label">Online Right Now</div>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-icon amber" style="background:rgba(230,81,0,0.12);color:#E65100;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </div>
        <div class="stat-info">
          <div class="stat-value" style="color:#E65100;">${idleCount}</div>
          <div class="stat-label">Idle / Background</div>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-icon gray" style="background:rgba(117,117,117,0.12);color:#757575;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
        </div>
        <div class="stat-info">
          <div class="stat-value" style="color:#616161;">${offlineCount}</div>
          <div class="stat-label">Offline Staff</div>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-icon blue" style="background:rgba(25,118,210,0.12);color:#1976D2;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        </div>
        <div class="stat-info">
          <div class="stat-value" style="color:#1565C0;">${todayLogsCount}</div>
          <div class="stat-label">Actions Logged Today</div>
        </div>
      </div>
    `;
  }

  // Render Live Presence Table
  function renderPresenceTable() {
    const el = document.getElementById('sa-presence-table');
    if (!el) return;

    const q = (document.getElementById('sa-presence-search')?.value || '').toLowerCase();
    const filtered = allUsers.filter(u => {
      if (!q) return true;
      return (u.displayName || '').toLowerCase().includes(q) ||
             (u.email || '').toLowerCase().includes(q) ||
             (u.role || '').toLowerCase().includes(q);
    });

    if (!filtered.length) {
      el.innerHTML = `<div class="table-empty">No staff members found matching search.</div>`;
      return;
    }

    // Sort: Online first, then Idle, then Offline, then Name
    filtered.sort((a, b) => {
      const pa = getPresenceStatus(a).status;
      const pb = getPresenceStatus(b).status;
      const order = { online: 0, idle: 1, offline: 2 };
      if (order[pa] !== order[pb]) return order[pa] - order[pb];
      return (a.displayName || '').localeCompare(b.displayName || '');
    });

    el.innerHTML = `
      <div class="table-wrapper" style="border-radius:0;border:none;box-shadow:none;">
        <table>
          <thead>
            <tr>
              <th>Staff Member</th>
              <th>Role</th>
              <th>Status</th>
              <th>Current Page</th>
              <th>Device / Platform</th>
              <th>Last Active / Login</th>
              <th style="text-align:right">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map(u => {
              const p = getPresenceStatus(u);
              const isMe = u.id === appState.uid;
              let statusBadgeHTML = '';

              if (p.status === 'online') {
                statusBadgeHTML = `
                  <span class="flex items-center gap-1 font-medium" style="color:#2E7D32;font-size:0.8rem;">
                    <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#2E7D32;box-shadow:0 0 6px rgba(46,125,50,0.6)"></span>
                    Online
                  </span>`;
              } else if (p.status === 'idle') {
                statusBadgeHTML = `
                  <span class="flex items-center gap-1 font-medium" style="color:#E65100;font-size:0.8rem;">
                    <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#FB8C00;"></span>
                    ${p.label}
                  </span>`;
              } else {
                statusBadgeHTML = `
                  <span class="flex items-center gap-1 text-secondary" style="font-size:0.8rem;">
                    <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#BDBDBD;"></span>
                    ${p.lastSeen ? timeAgo(p.lastSeen) : 'Never seen'}
                  </span>`;
              }

              return `
                <tr>
                  <td>
                    <div class="flex items-center gap-2">
                      <div class="avatar" style="background:${avatarBg(u.role)}">${initials(u.displayName)}</div>
                      <div>
                        <div class="font-medium flex items-center gap-1">
                          ${escapeHtml(u.displayName || '—')}
                          ${isMe ? '<span class="badge badge-gray text-xs" style="padding:1px 5px;">You</span>' : ''}
                        </div>
                        <div class="text-xs text-secondary">${escapeHtml(u.email || '—')}</div>
                      </div>
                    </div>
                  </td>
                  <td>${roleBadge(u.role)}</td>
                  <td>${statusBadgeHTML}</td>
                  <td>
                    ${p.status !== 'offline' && u.currentRoute
                      ? `<span class="badge badge-info" style="font-size:0.75rem;padding:3px 7px;">${escapeHtml(u.currentRoute)}</span>`
                      : '<span class="text-hint text-xs">—</span>'}
                  </td>
                  <td class="text-sm text-secondary">
                    ${u.device ? escapeHtml(u.device) : '<span class="text-hint">—</span>'}
                  </td>
                  <td class="text-sm">
                    ${u.lastLogin ? `
                      <div>${formatDateTime(u.lastLogin)}</div>
                      <div class="text-xs text-hint">${timeAgo(u.lastLogin)}</div>`
                      : '<span class="text-hint">—</span>'}
                  </td>
                  <td style="text-align:right">
                    <button class="btn btn-secondary btn-sm" onclick="window._viewUserLogs('${u.id}')" title="View individual activity audit trail">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.95"/></svg>
                      Logs
                    </button>
                  </td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // Populate staff dropdown for activity filtering
  function populateStaffFilter() {
    const sEl = document.getElementById('sa-log-user');
    if (!sEl) return;
    const curr = sEl.value;
    sEl.innerHTML = '<option value="">All Staff</option>';
    allUsers.forEach(u => {
      const opt = new Option(u.displayName + (u.role === 'super_admin' ? ' (Super Admin)' : ` (${roleBadgeText(u.role)})`), u.id);
      sEl.add(opt);
    });
    sEl.value = curr;
  }

  // Render Live Activity Stream
  function renderLogStream() {
    const el = document.getElementById('sa-stream-content');
    const headerEl = document.getElementById('sa-log-count-header');
    if (!el) return;

    const q        = (document.getElementById('sa-log-search')?.value || '').toLowerCase();
    const userId   = document.getElementById('sa-log-user')?.value;
    const category = document.getElementById('sa-log-action')?.value;

    const filtered = allLogs.filter(log => {
      if (userId && log.actorId !== userId) return false;
      if (category) {
        if (category === 'AUTH' && !log.action.startsWith('USER_LOGIN') && !log.action.startsWith('USER_LOGOUT') && !log.action.startsWith('AUTH_')) return false;
        if (category === 'BOOKING' && !log.action.startsWith('BOOKING_') && !log.action.startsWith('STATUS_') && !log.action.startsWith('SCHEDULE_') && !log.action.startsWith('SALESPERSON_')) return false;
        if (category === 'CUSTOMER' && !log.action.startsWith('CUSTOMER_')) return false;
        if (category === 'USER' && !log.action.startsWith('USER_CREATED') && !log.action.startsWith('USER_UPDATED') && !log.action.startsWith('USER_DEACTIVATED') && !log.action.startsWith('USER_ACTIVATED')) return false;
        if (category === 'PROFILE' && !log.action.startsWith('PROFILE_') && !log.action.startsWith('PASSWORD_') && !log.action.startsWith('EMAIL_')) return false;
      }
      if (q) {
        const text = `${log.actorName || ''} ${log.action || ''} ${log.bookingId || ''} ${JSON.stringify(log.details || {})}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });

    if (headerEl) {
      headerEl.innerHTML = `
        <div class="card-title">Live Audit Stream</div>
        <div class="text-sm text-secondary">${filtered.length} event${filtered.length !== 1 ? 's' : ''} logged</div>`;
    }

    if (!filtered.length) {
      el.innerHTML = `<div class="table-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        No activity events match the selected filters.
      </div>`;
      return;
    }

    el.innerHTML = `
      <div class="table-wrapper" style="border-radius:0;border:none;box-shadow:none;">
        <table>
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Staff Actor</th>
              <th>Action</th>
              <th>Target / Item</th>
              <th>Activity Details</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map(l => `
              <tr>
                <td class="text-sm" style="white-space:nowrap;">
                  <div>${formatDateTime(l.timestamp)}</div>
                  <div class="text-xs text-hint">${timeAgo(l.timestamp)}</div>
                </td>
                <td>
                  <div class="font-medium text-sm">${escapeHtml(l.actorName || 'System')}</div>
                  <div class="text-xs text-secondary">${l.actorId ? `ID: ${l.actorId.slice(0,6)}…` : ''}</div>
                </td>
                <td>
                  <span class="badge ${formatActionBadgeClass(l.action)}">${formatActionName(l.action)}</span>
                </td>
                <td>
                  ${l.bookingId ? `
                    <a href="#" onclick="event.preventDefault();window._navigate('/schedules/view/${l.bookingId}')"
                       class="text-sm text-blue" style="font-family:monospace;font-weight:600;">
                      #${l.bookingId.slice(0,8)}
                    </a>`
                    : (l.details?.customerName ? `<span class="text-sm font-medium">${escapeHtml(l.details.customerName)}</span>` : '<span class="text-hint">—</span>')}
                </td>
                <td class="text-sm text-secondary">
                  ${formatActivityDetails(l.details, l.action)}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  // Drilldown modal for an individual user
  window._viewUserLogs = (uid) => {
    const user = allUsers.find(u => u.id === uid);
    const userLogs = allLogs.filter(l => l.actorId === uid);
    const p = getPresenceStatus(user);

    showModal({
      title: `Staff Audit: ${escapeHtml(user?.displayName || uid)}`,
      wide: true,
      body: `
        <div style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:var(--radius-md);padding:14px 18px;margin-bottom:16px;">
          <div class="flex items-center justify-between" style="flex-wrap:wrap;gap:10px;">
            <div class="flex items-center gap-3">
              <div class="avatar" style="width:42px;height:42px;font-size:0.9rem;background:${avatarBg(user?.role)}">${initials(user?.displayName)}</div>
              <div>
                <div class="font-semibold text-base">${escapeHtml(user?.displayName || '—')}</div>
                <div class="text-xs text-secondary">${escapeHtml(user?.email || '—')} &bull; ${roleBadgeText(user?.role)}</div>
              </div>
            </div>
            <div style="text-align:right;">
              <div class="text-xs text-secondary">Current Status</div>
              <div class="font-medium text-sm" style="color:${p.status === 'online' ? '#2E7D32' : p.status === 'idle' ? '#E65100' : '#757575'}">
                &bull; ${p.label}
              </div>
            </div>
          </div>
          <div class="mt-3 flex gap-4 text-xs text-secondary" style="border-top:1px solid var(--border-color);padding-top:8px;">
            <div><strong>Active Screen:</strong> ${escapeHtml(user?.currentRoute || '—')}</div>
            <div><strong>Device:</strong> ${escapeHtml(user?.device || '—')}</div>
            <div><strong>Total Logged Actions:</strong> ${userLogs.length}</div>
          </div>
        </div>

        <div class="card-title" style="margin-bottom:8px;">Recent Activities by this User</div>
        ${!userLogs.length ? '<div class="table-empty">No activity recorded for this user yet.</div>' : `
          <div class="table-wrapper" style="max-height:320px;overflow-y:auto;border:1px solid var(--border-color);">
            <table>
              <thead>
                <tr><th>Time</th><th>Action</th><th>Details</th></tr>
              </thead>
              <tbody>
                ${userLogs.map(l => `
                  <tr>
                    <td class="text-xs" style="white-space:nowrap;">
                      <div>${formatDateTime(l.timestamp)}</div>
                      <div class="text-hint">${timeAgo(l.timestamp)}</div>
                    </td>
                    <td><span class="badge ${formatActionBadgeClass(l.action)}">${formatActionName(l.action)}</span></td>
                    <td class="text-xs text-secondary">${formatActivityDetails(l.details, l.action)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>`}
      `,
      confirmText: 'Close',
      cancelText: null,
    });
  };

  // Event Listeners
  document.getElementById('sa-refresh-btn')?.addEventListener('click', () => {
    subscribeUsers();
    subscribeLogs();
  });
  document.getElementById('sa-presence-search')?.addEventListener('input', debounce(renderPresenceTable, 200));
  document.getElementById('sa-log-search')?.addEventListener('input', debounce(renderLogStream, 200));
  document.getElementById('sa-log-user')?.addEventListener('change', renderLogStream);
  document.getElementById('sa-log-action')?.addEventListener('change', renderLogStream);
  document.getElementById('sa-log-clear')?.addEventListener('click', () => {
    document.getElementById('sa-log-search').value = '';
    document.getElementById('sa-log-user').value = '';
    document.getElementById('sa-log-action').value = '';
    renderLogStream();
  });

  // Initial load
  subscribeUsers();
  subscribeLogs();

  return () => {
    if (unsubUsers) { unsubUsers(); unsubUsers = null; }
    if (unsubLogs) { unsubLogs(); unsubLogs = null; }
  };
}

/* ── Formatting Helpers ───────────────────────────────────── */
function avatarBg(role) {
  const map = {
    super_admin:  'rgba(74,20,140,0.15)',
    admin:        'rgba(13,71,161,0.15)',
    office_staff: 'rgba(25,118,210,0.12)',
    salesperson:  '#EEEEEE'
  };
  return map[role] || '#EEEEEE';
}

function roleBadgeText(role) {
  const map = { super_admin: 'Super Admin', admin: 'Admin', office_staff: 'Office Staff', salesperson: 'Salesperson' };
  return map[role] || role || 'User';
}

function formatActionName(action) {
  const map = {
    'USER_LOGIN':             'Logged In',
    'USER_LOGOUT':            'Logged Out',
    'BOOKING_CREATED':        'Created Schedule',
    'BOOKING_UPDATED':        'Updated Schedule',
    'BOOKING_CANCELLED':      'Cancelled Schedule',
    'STATUS_CHANGED':         'Changed Status',
    'SALESPERSON_REASSIGNED': 'Reassigned Salesperson',
    'SCHEDULE_EXPORTED':      'Exported CSV',
    'CUSTOMER_CREATED':       'Created Customer',
    'CUSTOMER_UPDATED':       'Updated Customer',
    'USER_CREATED':           'Created User Account',
    'USER_UPDATED':           'Updated User Account',
    'USER_DEACTIVATED':       'Deactivated User',
    'USER_ACTIVATED':         'Activated User',
    'PROFILE_NAME_CHANGED':   'Changed Name',
    'PASSWORD_CHANGED':       'Changed Password',
    'EMAIL_CHANGED':          'Changed Email',
  };
  return map[action] || action.replace(/_/g, ' ');
}

function formatActionBadgeClass(action) {
  if (action === 'USER_LOGIN') return 'badge-success';
  if (action === 'USER_LOGOUT') return 'badge-gray';
  if (action.includes('CREATED')) return 'badge-navy';
  if (action.includes('CANCELLED') || action.includes('DEACTIVATED')) return 'badge-danger';
  if (action.includes('STATUS') || action.includes('UPDATED')) return 'badge-info';
  return 'badge-gray';
}

function formatActivityDetails(details, action) {
  if (!details || typeof details !== 'object' || Object.keys(details).length === 0) {
    return '<span class="text-hint">—</span>';
  }
  const parts = [];
  if (details.customerName) parts.push(`<strong>Customer:</strong> ${escapeHtml(details.customerName)}`);
  if (details.serviceType) parts.push(`<strong>Service:</strong> ${escapeHtml(details.serviceType)}`);
  if (details.salesperson) parts.push(`<strong>Salesperson:</strong> ${escapeHtml(details.salesperson)}`);
  if (details.oldStatus && details.newStatus) parts.push(`<strong>Status:</strong> ${escapeHtml(details.oldStatus)} ➔ ${escapeHtml(details.newStatus)}`);
  if (details.notes) parts.push(`<strong>Notes:</strong> ${escapeHtml(details.notes)}`);
  if (details.email) parts.push(`<strong>Email:</strong> ${escapeHtml(details.email)}`);
  if (details.device) parts.push(`<strong>Device:</strong> ${escapeHtml(details.device)}`);
  if (details.count != null) parts.push(`<strong>Export count:</strong> ${details.count} records`);
  if (details.message) parts.push(escapeHtml(details.message));

  if (!parts.length) {
    return `<span style="font-family:monospace;font-size:0.75rem;">${escapeHtml(JSON.stringify(details))}</span>`;
  }
  return parts.join(' &bull; ');
}
