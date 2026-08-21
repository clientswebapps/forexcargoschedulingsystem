/**
 * my-schedule.js — Salesperson's own schedule
 * Shows only schedules where salespersonId === current user's UID
 */
'use strict';
import { Bookings, ActivityLog } from '../db.js';
import { formatDateTime, formatDate, formatBookingDateTime, statusBadge, serviceBadge, loadingHTML, errorHTML, escapeHtml, debounce, getDateRange, showToast } from '../utils.js';
import { openScheduleModal } from './booking-form.js';

export async function renderMySchedule(container, appState) {
  const uid = appState.uid;

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">My Schedule</h1>
        <div class="page-subtitle">Your assigned schedules</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-secondary" id="my-print-btn">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          Print My Schedule
        </button>
        <button class="btn btn-primary" id="my-new-schedule-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Create Schedule
        </button>
      </div>
    </div>

    <!-- Filters -->
    <div class="filter-bar">
      <div class="filter-row">
        <div class="filter-group">
          <div class="filter-label">Date Range</div>
          <select id="ms-date-range" class="filter-control">
            <option value="today" selected>Today</option>
            <option value="week">This Week</option>
            <option value="month">This Month</option>
            <option value="all">All Time</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <div class="filter-group">
          <div class="filter-label">Period (AM/PM)</div>
          <select id="ms-period" class="filter-control">
            <option value="">All Periods</option>
            <option value="AM">AM</option>
            <option value="PM">PM</option>
          </select>
        </div>
        <div class="filter-group" id="ms-custom-from-group" style="display:none;">
          <div class="filter-label">Date From</div>
          <input type="date" id="ms-date-from" class="filter-control">
        </div>
        <div class="filter-group" id="ms-custom-to-group" style="display:none;">
          <div class="filter-label">Date To</div>
          <input type="date" id="ms-date-to" class="filter-control">
        </div>
        <div class="filter-group">
          <div class="filter-label">Status</div>
          <select id="ms-status" class="filter-control">
            <option value="">All Statuses</option>
            <option>Pending</option><option>Completed</option><option>Cancelled</option>
          </select>
        </div>

        <div class="filter-group">
          <div class="filter-label">Created By</div>
          <input type="text" id="ms-booked-by" class="filter-control" placeholder="Search created by…">
        </div>
        <div class="filter-actions">
          <button class="btn btn-secondary btn-sm" id="ms-clear-btn">Clear</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div id="ms-count" class="card-header">
        <div class="card-title">My Assigned Schedules</div>
      </div>
      <div id="ms-table">${loadingHTML()}</div>
    </div>`;

  let allBookings = [];
  let unsubscribe = null;

  function load() {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }

    const rangeType = document.getElementById('ms-date-range')?.value || 'today';
    const customFrom = document.getElementById('ms-date-from')?.value || '';
    const customTo = document.getElementById('ms-date-to')?.value || '';
    const { dateFrom, dateTo } = getDateRange(rangeType, customFrom, customTo);

    const status = document.getElementById('ms-status')?.value;
    const period = document.getElementById('ms-period')?.value;

    const tableEl = document.getElementById('ms-table');
    if (tableEl && !allBookings.length) {
      tableEl.innerHTML = loadingHTML();
    }

    try {
      unsubscribe = Bookings.onMineSnapshot(
        uid,
        {
          dateFrom:        dateFrom || undefined,
          dateTo:          dateTo   || undefined,
          status:          status   || undefined,
          scheduledPeriod: period   || undefined,
        },
        (records) => {
          allBookings = records;
          applySearch();
        },
        (err) => {
          const el = document.getElementById('ms-table');
          if (el) el.innerHTML = errorHTML('Failed to sync your schedule in real time: ' + (err.message || err));
        }
      );
    } catch (err) {
      if (tableEl) tableEl.innerHTML = errorHTML('Failed to load your schedule.');
    }
  }

  function applySearch() {
    const searchInput = document.getElementById('ms-booked-by');
    const q = (searchInput?.value || '').toLowerCase();
    const filtered = q
      ? allBookings.filter(b => (b.bookedByName || '').toLowerCase().includes(q))
      : allBookings;
    renderTable(filtered);
  }

  function renderTable(list) {
    const countEl = document.getElementById('ms-count');
    if (countEl) {
      countEl.innerHTML = `
        <div class="card-title">My Assigned Schedules</div>
        <div class="text-sm text-secondary">${list.length} schedule${list.length !== 1 ? 's' : ''}</div>`;
    }

    const el = document.getElementById('ms-table');
    if (!el) return;
    if (!list.length) {
      el.innerHTML = `<div class="table-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        No schedules assigned to you for the selected period.</div>`;
      return;
    }
    el.innerHTML = `
      <div class="table-wrapper" style="border-radius:0;border:none;box-shadow:none;">
        <table>
          <thead><tr>
            <th>Date</th><th>Time</th><th>Customer</th><th>Contact</th>
            <th>Service</th><th>Created By</th><th>Status</th><th style="text-align:right"></th>
          </tr></thead>
          <tbody>
            ${list.map(b => {
              const isOwnBooking = b.bookedById === uid;
              return `
              <tr class="clickable" onclick="window._navigate('/schedules/view/${b.id}')">
                <td class="text-sm" style="white-space:nowrap">${formatDate(b.scheduledDate)}</td>
                <td class="text-sm" style="white-space:nowrap">${escapeHtml(b.scheduledTime || '')} <span class="badge badge-gray text-xs" style="margin-left: 2px;">${escapeHtml(b.scheduledPeriod || 'Anytime')}</span></td>
                <td><div class="font-medium">${escapeHtml(b.snapshot_name)}</div>
                    <div class="text-xs text-secondary">${escapeHtml(b.snapshot_address || '')}</div></td>
                <td class="text-sm">${escapeHtml(b.snapshot_contactNumber)}</td>
                <td>${serviceBadge(b.serviceType)}
                    <div class="text-xs text-secondary mt-1">${escapeHtml((b.serviceDetails||'').slice(0,30))}${(b.serviceDetails||'').length>30?'…':''}</div></td>
                <td class="text-sm text-secondary">${escapeHtml(b.bookedByName || '—')}</td>
                <td>${statusBadge(b.status)}</td>
                <td style="text-align:right" onclick="event.stopPropagation()">
                  ${isOwnBooking ? `
                    <div class="row-actions-stacked">
                      <button class="btn btn-secondary btn-sm" onclick="window._openEditSchedule('${b.id}')">Edit</button>
                      <button class="btn btn-danger-outline btn-sm" onclick="window._deleteMySchedule(this, '${b.id}', '${escapeHtml(b.snapshot_name)}')">Delete</button>
                    </div>
                  ` : ''}
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  }

  // Events
  document.getElementById('ms-status')?.addEventListener('change', load);
  document.getElementById('ms-period')?.addEventListener('change', load);
  document.getElementById('ms-date-from')?.addEventListener('change', load);
  document.getElementById('ms-date-to')?.addEventListener('change', load);
  document.getElementById('ms-booked-by')?.addEventListener('input', debounce(applySearch, 250));

  // Date Range change
  document.getElementById('ms-date-range')?.addEventListener('change', (e) => {
    const isCustom = e.target.value === 'custom';
    const fromGroup = document.getElementById('ms-custom-from-group');
    const toGroup = document.getElementById('ms-custom-to-group');
    if (fromGroup) fromGroup.style.display = isCustom ? 'flex' : 'none';
    if (toGroup) toGroup.style.display = isCustom ? 'flex' : 'none';
    load();
  });

  document.getElementById('ms-clear-btn')?.addEventListener('click', () => {
    document.getElementById('ms-date-range').value = 'today';
    document.getElementById('ms-date-from').value = '';
    document.getElementById('ms-date-to').value   = '';
    document.getElementById('ms-custom-from-group').style.display = 'none';
    document.getElementById('ms-custom-to-group').style.display = 'none';
    document.getElementById('ms-status').value    = '';
    document.getElementById('ms-period').value    = '';
    document.getElementById('ms-booked-by').value = '';
    load();
  });

  // Create Schedule opens modal
  document.getElementById('my-new-schedule-btn')?.addEventListener('click', () => {
    openScheduleModal(appState, null);
  });

  document.getElementById('my-print-btn')?.addEventListener('click', () => {
    const rangeType = document.getElementById('ms-date-range')?.value || 'today';
    const customFrom = document.getElementById('ms-date-from')?.value || '';
    const customTo = document.getElementById('ms-date-to')?.value || '';
    const { dateFrom, dateTo } = getDateRange(rangeType, customFrom, customTo);
    const status   = document.getElementById('ms-status')?.value;
    const period   = document.getElementById('ms-period')?.value;
    const params   = new URLSearchParams({ salespersonId: uid, salespersonName: appState.user.displayName });
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo)   params.set('dateTo', dateTo);
    if (status)   params.set('status', status);
    if (period)   params.set('scheduledPeriod', period);
    if (rangeType) params.set('rangeType', rangeType);
    window._navigate && window._navigate('/print?' + params.toString());
  });

  // Action handlers for edit/delete
  window._openEditSchedule = (id) => {
    openScheduleModal(appState, id);
  };

  window._deleteMySchedule = async (btnEl, id, customerName) => {
    if (!confirm(`Are you sure you want to delete the schedule for "${customerName}"?\nThis action cannot be undone.`)) {
      return;
    }

    btnEl.disabled = true;
    btnEl.classList.add('btn-loading');

    try {
      await Bookings.delete(id);
      try {
        await ActivityLog.write({
          bookingId: id,
          action: 'BOOKING_DELETED',
          details: { customer: customerName }
        });
      } catch(_) {}
      showToast('Schedule deleted successfully.', 'success');
    } catch (err) {
      console.error('Failed to delete schedule:', err);
      showToast('Failed to delete schedule: ' + (err.message || ''), 'error');
      btnEl.disabled = false;
      btnEl.classList.remove('btn-loading');
    }
  };

  load();

  // Return cleanup function to unsubscribe when navigating away
  return () => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };
}
