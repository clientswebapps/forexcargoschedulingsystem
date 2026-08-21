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
        <div class="filter-group" style="flex:2;min-width:160px;">
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
    </div>`;

  let allLogs = [];
  let unsubscribe = null;

  function load() {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    const bookingId = document.getElementById('al-booking-id')?.value.trim();
    const tableEl = document.getElementById('al-content');
    if (tableEl && !allLogs.length) {
      tableEl.innerHTML = loadingHTML();
    }
    try {
      unsubscribe = ActivityLog.onSnapshot({ bookingId: bookingId || undefined }, (list) => {
        allLogs = list;
        applyFilter();
      });
    } catch (err) {
      if (tableEl) tableEl.innerHTML = errorHTML('Failed to load activity log.');
    }
  }

  function applyFilter() {
    const search = (document.getElementById('al-search')?.value || '').toLowerCase();
    const action = document.getElementById('al-action')?.value;

    const filtered = allLogs.filter(log => {
      if (action && log.action !== action) return false;
      if (search && !(
        (log.actorName||'').toLowerCase().includes(search) ||
        (log.action||'').toLowerCase().includes(search) ||
        (log.bookingId||'').toLowerCase().includes(search)
      )) return false;
      return true;
    });

    renderTable(filtered);
  }

  function renderTable(list) {
    const countEl = document.getElementById('al-count');
    if (countEl) {
      countEl.innerHTML = `
        <div class="card-title">Activity History</div>
        <div class="text-sm text-secondary">${list.length} entr${list.length !== 1 ? 'ies' : 'y'}</div>`;
    }

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

  // Events
  document.getElementById('al-search')?.addEventListener('input', debounce(applyFilter, 250));
  document.getElementById('al-action')?.addEventListener('change', applyFilter);
  document.getElementById('al-booking-id')?.addEventListener('change', load);
  document.getElementById('al-clear-btn')?.addEventListener('click', () => {
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
  };
  return map[action] || 'badge-gray';
}

function formatDetails(details = {}) {
  if (!details || !Object.keys(details).length) return '—';
  return Object.entries(details)
    .map(([k, v]) => `<span style="color:var(--text-secondary)">${escapeHtml(k)}:</span> ${escapeHtml(String(v))}`)
    .join('&nbsp; · &nbsp;');
}
