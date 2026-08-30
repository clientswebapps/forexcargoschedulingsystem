/**
 * activity-log.js — Activity / Audit Log page (Admin + Office Staff)
 */
'use strict';
import { ActivityLog, Users } from '../db.js';
import { loadingHTML, errorHTML, escapeHtml, timeAgo, formatDateTime, debounce } from '../utils.js';

export async function renderActivityLog(container, appState) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Activity Log</h1>
        <div class="page-subtitle">Full audit trail of system actions</div>
      </div>
    </div>

    <div class="filter-bar">
      <div class="filter-row">
        <div class="filter-group flex-2">
          <div class="filter-label">Search (actor or action)</div>
          <input type="text" id="al-search" class="filter-control" placeholder="Search…">
        </div>
        <div class="filter-group">
          <div class="filter-label">Action Type</div>
          <select id="al-action" class="filter-control">
            <option value="">All Actions</option>
            <option value="BOOKING_CREATED">Schedule Created</option>
            <option value="BOOKING_UPDATED">Schedule Updated</option>
            <option value="BOOKING_CANCELLED">Schedule Cancelled</option>
            <option value="STATUS_CHANGED">Status Changed</option>
            <option value="SALESPERSON_REASSIGNED">Salesperson Reassigned</option>
            <option value="SCHEDULES_PRINTED">Schedules Printed</option>
            <option value="SCHEDULE_EXPORTED">Schedules Exported</option>
            <option value="CUSTOMER_CREATED">Customer Created</option>
            <option value="CUSTOMER_UPDATED">Customer Updated</option>
            <option value="CUSTOMER_DELETED">Customer Deleted</option>
            <option value="CUSTOMER_EXPORTED">Customer Exported</option>
            <option value="USER_LOGIN">User Login</option>
          </select>
        </div>
        <div class="filter-group">
          <div class="filter-label">Schedule ID</div>
          <input type="text" id="al-booking-id" class="filter-control" placeholder="Exact schedule ID…">
        </div>
        <div class="filter-actions">
          <button class="btn btn-secondary btn-sm" id="al-clear-btn">Clear</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div id="al-count" class="card-header">
        <div class="card-title">Activity History</div>
      </div>
      <div id="al-content">${loadingHTML()}</div>
      <div id="al-pagination"></div>
    </div>`;

  const isSuper = appState.user.role === 'super_admin';
  let hiddenUids = new Set();
  let allLogs = [];
  let filteredLogs = [];
  let currentPage = 1;
  let pageSize = 10;
  let unsubscribe = null;

  async function load() {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    const bookingId = document.getElementById('al-booking-id')?.value.trim();
    const tableEl = document.getElementById('al-content');
    if (tableEl && !allLogs.length) {
      tableEl.innerHTML = loadingHTML();
    }

    if (!isSuper && hiddenUids.size === 0) {
      try {
        const users = await Users.getAll();
        users.forEach(u => {
          if (u.role === 'super_admin' || u.isInvisible) {
            hiddenUids.add(u.id);
          }
        });
      } catch(_) {}
    }

    try {
      unsubscribe = ActivityLog.onSnapshot({ bookingId: bookingId || undefined }, (list) => {
        if (isSuper) {
          allLogs = list;
        } else {
          allLogs = list.filter(log => {
            // Hide if actor is super admin or invisible account
            if (log.actorRole === 'super_admin' || log.isInvisible === true) return false;
            if (log.actorId && hiddenUids.has(log.actorId)) return false;
            // Hide if action details reference super admin or invisible account
            if (log.details?.role === 'super_admin' || log.details?.isInvisible === true) return false;
            if (log.details?.targetUserId && hiddenUids.has(log.details.targetUserId)) return false;
            return true;
          });
        }
        applyFilter();
      });
    } catch (err) {
      if (tableEl) tableEl.innerHTML = errorHTML('Failed to load activity log.');
    }
  }

  function applyFilter() {
    const search = (document.getElementById('al-search')?.value || '').toLowerCase();
    const action = document.getElementById('al-action')?.value;

    filteredLogs = allLogs.filter(log => {
      if (action && log.action !== action) return false;
      if (search && !(
        (log.actorName||'').toLowerCase().includes(search) ||
        (log.action||'').toLowerCase().includes(search) ||
        (log.bookingId||'').toLowerCase().includes(search)
      )) return false;
      return true;
    });

    renderView();
  }

  function renderView() {
    const totalItems = filteredLogs.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

    const countEl = document.getElementById('al-count');
    if (countEl) {
      countEl.innerHTML = `
        <div class="card-title">Activity History</div>
        <div class="text-sm text-secondary">${totalItems} entr${totalItems !== 1 ? 'ies' : 'y'}${totalItems > 0 ? ` (Paginated: ${pageSize} per page)` : ''}</div>`;
    }

    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIdx = (currentPage - 1) * pageSize;
    const endIdx = startIdx + pageSize;
    const pageItems = filteredLogs.slice(startIdx, endIdx);

    renderTable(pageItems);
    renderPagination(totalItems, totalPages);
  }

  function renderTable(list) {
    const el = document.getElementById('al-content');
    if (!el) return;
    if (!list.length) {
      el.innerHTML = `<div class="table-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.95"/></svg>
        No activity log entries found.</div>`;
      return;
    }
    el.innerHTML = `
      <div class="table-wrapper" style="border-radius:0;border:none;box-shadow:none;">
        <table>
          <thead><tr>
            <th>Timestamp</th><th>Action</th><th>Actor</th><th>Schedule</th><th>Details</th>
          </tr></thead>
          <tbody>
            ${list.map(log => `
              <tr>
                <td class="text-sm" style="white-space:nowrap">${formatDateTime(log.timestamp)}<br>
                  <span class="text-xs text-hint">${timeAgo(log.timestamp)}</span></td>
                <td><span class="badge ${actionBadgeClass(log.action)}">${formatAction(log.action)}</span></td>
                <td class="text-sm font-medium">${escapeHtml(log.actorName || '—')}</td>
                <td>${log.bookingId
                  ? `<a href="#" onclick="event.preventDefault();window._navigate('/schedules/view/${log.bookingId}')"
                      class="text-sm text-blue" style="font-family:monospace">${log.bookingId.slice(0,8)}…</a>`
                  : '<span class="text-hint">—</span>'}</td>
                <td class="text-sm text-secondary">${formatDetails(log.details)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function renderPagination(totalItems, totalPages) {
    const pagEl = document.getElementById('al-pagination');
    if (!pagEl) return;
    if (!totalItems) {
      pagEl.innerHTML = '';
      return;
    }

    const startItem = (currentPage - 1) * pageSize + 1;
    const endItem = Math.min(currentPage * pageSize, totalItems);

    // Build numbered page buttons
    let pageBtns = '';
    const maxVisibleBtns = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisibleBtns / 2));
    let endPage = Math.min(totalPages, startPage + maxVisibleBtns - 1);
    if (endPage - startPage + 1 < maxVisibleBtns) {
      startPage = Math.max(1, endPage - maxVisibleBtns + 1);
    }

    if (startPage > 1) {
      pageBtns += `<button class="pagination-btn" data-page="1">1</button>`;
      if (startPage > 2) {
        pageBtns += `<span class="pagination-ellipsis">…</span>`;
      }
    }

    for (let p = startPage; p <= endPage; p++) {
      pageBtns += `<button class="pagination-btn ${p === currentPage ? 'active' : ''}" data-page="${p}">${p}</button>`;
    }

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) {
        pageBtns += `<span class="pagination-ellipsis">…</span>`;
      }
      pageBtns += `<button class="pagination-btn" data-page="${totalPages}">${totalPages}</button>`;
    }

    pagEl.innerHTML = `
      <div class="pagination-container">
        <div class="pagination-left">
          <div class="pagination-size-select">
            <span>Show</span>
            <select id="al-page-size" class="pagination-select-control" aria-label="Entries per page">
              <option value="10" ${pageSize === 10 ? 'selected' : ''}>10</option>
              <option value="20" ${pageSize === 20 ? 'selected' : ''}>20</option>
              <option value="50" ${pageSize === 50 ? 'selected' : ''}>50</option>
            </select>
            <span>per page</span>
          </div>
          <div class="pagination-info">
            Showing <strong>${startItem}–${endItem}</strong> of <strong>${totalItems}</strong> entries
          </div>
        </div>
        <nav class="pagination-nav" aria-label="Activity log pagination">
          <button class="pagination-btn" id="al-first-page" ${currentPage === 1 ? 'disabled' : ''} title="First Page">«</button>
          <button class="pagination-btn" id="al-prev-page" ${currentPage === 1 ? 'disabled' : ''} title="Previous Page">‹</button>
          ${pageBtns}
          <button class="pagination-btn" id="al-next-page" ${currentPage === totalPages ? 'disabled' : ''} title="Next Page">›</button>
          <button class="pagination-btn" id="al-last-page" ${currentPage === totalPages ? 'disabled' : ''} title="Last Page">»</button>
        </nav>
      </div>
    `;

    // Page size change handler
    pagEl.querySelector('#al-page-size')?.addEventListener('change', (e) => {
      pageSize = Number(e.target.value);
      currentPage = 1;
      renderView();
    });

    // Navigation buttons
    pagEl.querySelector('#al-first-page')?.addEventListener('click', () => {
      if (currentPage > 1) { currentPage = 1; renderView(); }
    });
    pagEl.querySelector('#al-prev-page')?.addEventListener('click', () => {
      if (currentPage > 1) { currentPage--; renderView(); }
    });
    pagEl.querySelector('#al-next-page')?.addEventListener('click', () => {
      if (currentPage < totalPages) { currentPage++; renderView(); }
    });
    pagEl.querySelector('#al-last-page')?.addEventListener('click', () => {
      if (currentPage < totalPages) { currentPage = totalPages; renderView(); }
    });

    // Numbered buttons
    pagEl.querySelectorAll('.pagination-btn[data-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = Number(btn.getAttribute('data-page'));
        if (p && p !== currentPage) {
          currentPage = p;
          renderView();
        }
      });
    });
  }

  // Events
  document.getElementById('al-search')?.addEventListener('input', debounce(() => {
    currentPage = 1;
    applyFilter();
  }, 250));
  document.getElementById('al-action')?.addEventListener('change', () => {
    currentPage = 1;
    applyFilter();
  });
  document.getElementById('al-booking-id')?.addEventListener('change', () => {
    currentPage = 1;
    load();
  });
  document.getElementById('al-clear-btn')?.addEventListener('click', () => {
    currentPage = 1;
    document.getElementById('al-search').value    = '';
    document.getElementById('al-action').value    = '';
    document.getElementById('al-booking-id').value = '';
    load();
  });

  load();

  return () => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };
}

function formatAction(action) {
  const map = {
    BOOKING_CREATED:       'Created',
    BOOKING_UPDATED:       'Updated',
    BOOKING_CANCELLED:     'Cancelled',
    STATUS_CHANGED:        'Status Changed',
    SALESPERSON_REASSIGNED:'Reassigned',
    SCHEDULES_PRINTED:     'Printed Schedules',
    SCHEDULE_EXPORTED:     'Exported CSV',
    CUSTOMER_CREATED:      'Customer Created',
    CUSTOMER_UPDATED:      'Customer Updated',
    CUSTOMER_DELETED:      'Customer Deleted',
    CUSTOMER_EXPORTED:     'Customer Exported',
    USER_LOGIN:            'Logged In',
  };
  return map[action] || action;
}

function actionBadgeClass(action) {
  const map = {
    BOOKING_CREATED:       'badge-info',
    BOOKING_UPDATED:       'badge-gray',
    BOOKING_CANCELLED:     'badge-danger',
    STATUS_CHANGED:        'badge-warning',
    SALESPERSON_REASSIGNED:'badge-navy',
    SCHEDULES_PRINTED:     'badge-purple',
    SCHEDULE_EXPORTED:     'badge-info',
    CUSTOMER_CREATED:      'badge-green',
    CUSTOMER_UPDATED:      'badge-info',
    CUSTOMER_DELETED:      'badge-danger',
    CUSTOMER_EXPORTED:     'badge-purple',
    USER_LOGIN:            'badge-gray',
  };
  return map[action] || 'badge-gray';
}

function formatDetails(details = {}) {
  if (!details || !Object.keys(details).length) return '—';
  return Object.entries(details)
    .map(([k, v]) => `<span style="color:var(--text-secondary)">${escapeHtml(k)}:</span> ${escapeHtml(String(v))}`)
    .join('&nbsp; · &nbsp;');
}

