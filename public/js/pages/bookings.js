/**
 * bookings.js — All Schedules list with filters (Admin / Office Staff)
 */
'use strict';
import { Bookings, Users, ActivityLog } from '../db.js';
import { formatDateTime, formatDate, formatBookingDateTime, serviceBadge, loadingHTML, errorHTML, escapeHtml, debounce, getDateRange, showToast } from '../utils.js';
import { openScheduleModal } from './booking-form.js';

export async function renderBookings(container, appState) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Schedules</h1>
        <div class="page-subtitle">All schedule records</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-secondary" id="print-btn">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          Print
        </button>
        <button class="btn btn-primary" id="new-schedule-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Create Schedule
        </button>
      </div>
    </div>

    <!-- Filter Bar -->
    <div class="filter-bar">
      <div class="filter-row">
        <div class="filter-group" style="flex:2;min-width:160px;">
          <div class="filter-label">Customer / Phone</div>
          <input type="text" id="f-search" class="filter-control" placeholder="Search name or number…">
        </div>
        <div class="filter-group">
          <div class="filter-label">Date Range</div>
          <select id="f-date-range" class="filter-control">
            <option value="today" selected>Today</option>
            <option value="week">This Week</option>
            <option value="month">This Month</option>
            <option value="all">All Time</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <div class="filter-group">
          <div class="filter-label">Period (AM/PM)</div>
          <select id="f-period" class="filter-control">
            <option value="">All</option>
            <option value="AM">AM</option>
            <option value="PM">PM</option>
          </select>
        </div>
        <div class="filter-group" id="f-custom-from-group" style="display:none;">
          <div class="filter-label">Date From</div>
          <input type="date" id="f-date-from" class="filter-control">
        </div>
        <div class="filter-group" id="f-custom-to-group" style="display:none;">
          <div class="filter-label">Date To</div>
          <input type="date" id="f-date-to" class="filter-control">
        </div>
        <div class="filter-group">
          <div class="filter-label">Salesperson</div>
          <select id="f-salesperson" class="filter-control">
            <option value="">All</option>
          </select>
        </div>
        <div class="filter-group">
          <div class="filter-label">Status</div>
          <select id="f-status" class="filter-control">
            <option value="">All</option>
            <option>Pending</option><option>Completed</option><option>Cancelled</option>
          </select>
        </div>
        <div class="filter-group">
          <div class="filter-label">Service Type</div>
          <select id="f-type" class="filter-control">
            <option value="">All</option>
            <option>Pickup</option><option>Delivery</option><option>Custom</option>
          </select>
        </div>

        <div class="filter-group">
          <div class="filter-label">Created By</div>
          <select id="f-booked-by" class="filter-control">
            <option value="">All</option>
          </select>
        </div>
        <div class="filter-actions">
          <button class="btn btn-secondary btn-sm" id="clear-filters-btn">Clear</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div id="booking-count" class="card-header">
        <div class="card-title">Schedules</div>
      </div>
      <div id="bookings-table">${loadingHTML()}</div>
    </div>`;

  // Populate salesperson & created-by dropdowns
  let allStaff = [];
  try {
    allStaff = await Users.getAll();
    const salespeople = allStaff.filter(u => u.role === 'salesperson');
    const sEl = document.getElementById('f-salesperson');
    salespeople.forEach(u => sEl.add(new Option(u.displayName, u.id)));

    const bEl = document.getElementById('f-booked-by');
    allStaff.filter(u => u.role !== 'salesperson').forEach(u => bEl.add(new Option(u.displayName, u.id)));
    // Also add salespersons as they can create schedules
    salespeople.forEach(u => bEl.add(new Option(u.displayName + ' (Sales)', u.id)));
  } catch(_) {}

  let allBookings = [];
  let filtered    = [];
  let unsubscribe = null;

  function load() {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }

    const rangeType = document.getElementById('f-date-range')?.value || 'today';
    const customFrom = document.getElementById('f-date-from')?.value || '';
    const customTo = document.getElementById('f-date-to')?.value || '';
    const { dateFrom, dateTo } = getDateRange(rangeType, customFrom, customTo);

    const fStatus   = document.getElementById('f-status')?.value;
    const fType     = document.getElementById('f-type')?.value;
    const fPeriod   = document.getElementById('f-period')?.value;
    const fSales    = document.getElementById('f-salesperson')?.value;
    const fBookedBy = document.getElementById('f-booked-by')?.value;

    const tableEl = document.getElementById('bookings-table');
    if (tableEl && !allBookings.length) {
      tableEl.innerHTML = loadingHTML();
    }

    try {
      unsubscribe = Bookings.onAllSnapshot(
        {
          status:          fStatus   || undefined,
          serviceType:     fType     || undefined,
          salespersonId:   fSales    || undefined,
          bookedById:      fBookedBy || undefined,
          dateFrom:        dateFrom  || undefined,
          dateTo:          dateTo    || undefined,
          scheduledPeriod: fPeriod   || undefined,
        },
        (records) => {
          allBookings = records;
          applySearch();
        },
        (err) => {
          const el = document.getElementById('bookings-table');
          if (el) el.innerHTML = errorHTML('Failed to sync schedules in real time: ' + (err.message || err));
        }
      );
    } catch(err) {
      if (tableEl) tableEl.innerHTML = errorHTML('Failed to load schedules.');
    }
  }

  function applySearch() {
    const searchInput = document.getElementById('f-search');
    const q = (searchInput?.value || '').toLowerCase();
    filtered = q
      ? allBookings.filter(b =>
          (b.snapshot_name || '').toLowerCase().includes(q) ||
          (b.snapshot_contactNumber || '').includes(q)
        )
      : allBookings;
    renderTable(filtered);
  }

  function renderTable(list) {
    const countEl = document.getElementById('booking-count');
    if (countEl) {
      countEl.innerHTML = `
        <div class="card-title">Schedules</div>
        <div class="text-sm text-secondary">${list.length} record${list.length !== 1 ? 's' : ''}</div>`;
    }

    const el = document.getElementById('bookings-table');
    if (!el) return;
    if (!list.length) {
      el.innerHTML = `<div class="table-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        No schedules match the selected filters.</div>`;
      return;
    }
    el.innerHTML = `
      <div class="table-wrapper" style="border-radius:0;border:none;box-shadow:none;">
        <table>
          <thead><tr>
            <th>Date</th><th>Time</th><th>Customer</th><th>Contact</th>
            <th>Service</th><th>Salesperson</th><th>Created By</th><th>Status</th><th style="text-align:right">Actions</th>
          </tr></thead>
          <tbody>
            ${list.map(b => `
              <tr class="clickable" onclick="window._navigate && window._navigate('/schedules/view/${b.id}')">
                <td class="text-sm" style="white-space:nowrap">${formatDate(b.scheduledDate)}</td>
                <td class="text-sm" style="white-space:nowrap">${escapeHtml(b.scheduledTime || '')} <span class="badge badge-gray text-xs" style="margin-left:2px;">${escapeHtml(b.scheduledPeriod || 'Anytime')}</span></td>
                <td><div class="font-medium">${escapeHtml(b.snapshot_name)}</div></td>
                <td class="text-sm text-secondary">${escapeHtml(b.snapshot_contactNumber)}</td>
                <td>${serviceBadge(b.serviceType)}<div class="text-xs text-secondary mt-1">${escapeHtml((b.serviceDetails||'').slice(0,40))}${(b.serviceDetails||'').length>40?'…':''}</div></td>
                <td class="text-sm">${escapeHtml(b.salespersonName || '—')}</td>
                <td class="text-sm text-secondary">${escapeHtml(b.bookedByName || '—')}</td>
                <td onclick="event.stopPropagation()">
                  <select class="status-select status-select-${(b.status||'pending').toLowerCase()}"
                    data-id="${b.id}"
                    data-current="${b.status}"
                    onchange="window._updateScheduleStatus(this, '${b.id}', '${b.status}')">
                    <option value="Pending" ${b.status === 'Pending' ? 'selected' : ''}>Pending</option>
                    <option value="Completed" ${b.status === 'Completed' ? 'selected' : ''}>Completed</option>
                    <option value="Cancelled" ${b.status === 'Cancelled' ? 'selected' : ''}>Cancelled</option>
                  </select>
                </td>
                <td style="text-align:right" onclick="event.stopPropagation()">
                  <div class="row-actions-stacked">
                    <button class="btn btn-secondary btn-sm" onclick="window._openEditSchedule('${b.id}')">Edit</button>
                    <button class="btn btn-danger-outline btn-sm" onclick="window._deleteSchedule(this, '${b.id}', '${escapeHtml(b.snapshot_name)}')">Delete</button>
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  // Fast inline status change handler with race condition prevention
  window._updateScheduleStatus = async (selectEl, id, prevStatus) => {
    const newStatus = selectEl.value;
    if (newStatus === prevStatus) return;

    // Immediately disable to prevent race conditions / duplicate clicks
    selectEl.disabled = true;

    try {
      await Bookings.updateStatus(id, newStatus);
      await ActivityLog.write({
        bookingId: id,
        action: 'STATUS_CHANGED',
        details: { from: prevStatus, to: newStatus }
      });
      showToast(`Status updated to ${newStatus}.`, 'success');
    } catch (err) {
      console.error('Failed to update status:', err);
      // Revert UI on failure
      selectEl.value = prevStatus;
      selectEl.className = `status-select status-select-${prevStatus.toLowerCase()}`;
      showToast('Failed to update status: ' + (err.message || ''), 'error');
    } finally {
      selectEl.disabled = false;
    }
  };

  // Immediate delete schedule handler
  window._deleteSchedule = async (btnEl, id, customerName) => {
    if (!confirm(`Are you sure you want to delete the schedule for "${customerName}"?\nThis action cannot be undone.`)) {
      return;
    }

    btnEl.disabled = true;
    btnEl.classList.add('btn-loading');

    try {
      await Bookings.delete(id);
      await ActivityLog.write({
        bookingId: id,
        action: 'BOOKING_DELETED',
        details: { customer: customerName }
      });
      showToast(`Schedule for "${customerName}" deleted.`, 'success');
    } catch (err) {
      console.error('Failed to delete schedule:', err);
      btnEl.disabled = false;
      btnEl.classList.remove('btn-loading');
      showToast('Failed to delete schedule: ' + (err.message || ''), 'error');
    }
  };

  // Event bindings
  const filterIds = ['f-status','f-type','f-salesperson','f-booked-by','f-date-from','f-date-to','f-period'];
  filterIds.forEach(id => document.getElementById(id)?.addEventListener('change', load));
  document.getElementById('f-search')?.addEventListener('input', debounce(applySearch, 250));

  // Date Range dropdown change
  document.getElementById('f-date-range')?.addEventListener('change', (e) => {
    const isCustom = e.target.value === 'custom';
    const fromGroup = document.getElementById('f-custom-from-group');
    const toGroup = document.getElementById('f-custom-to-group');
    if (fromGroup) fromGroup.style.display = isCustom ? 'flex' : 'none';
    if (toGroup) toGroup.style.display = isCustom ? 'flex' : 'none';
    load();
  });

  document.getElementById('clear-filters-btn')?.addEventListener('click', () => {
    document.getElementById('f-search').value = '';
    document.getElementById('f-date-range').value = 'today';
    document.getElementById('f-date-from').value = '';
    document.getElementById('f-date-to').value = '';
    document.getElementById('f-custom-from-group').style.display = 'none';
    document.getElementById('f-custom-to-group').style.display = 'none';
    document.getElementById('f-status').value = '';
    document.getElementById('f-type').value = '';
    document.getElementById('f-period').value = '';
    document.getElementById('f-salesperson').value = '';
    document.getElementById('f-booked-by').value = '';
    load();
  });

  // Open Create Schedule modal
  document.getElementById('new-schedule-btn')?.addEventListener('click', () => {
    openScheduleModal(appState, null);
  });

  // Global handler for edit buttons
  window._openEditSchedule = (id) => {
    openScheduleModal(appState, id);
  };

  document.getElementById('print-btn')?.addEventListener('click', () => {
    // Pass current filter state to print page
    const params = new URLSearchParams();
    const fSales = document.getElementById('f-salesperson').value;
    const rangeType = document.getElementById('f-date-range')?.value || 'today';
    const customFrom = document.getElementById('f-date-from')?.value || '';
    const customTo = document.getElementById('f-date-to')?.value || '';
    const { dateFrom, dateTo } = getDateRange(rangeType, customFrom, customTo);
    const fSt    = document.getElementById('f-status').value;
    const fTy    = document.getElementById('f-type').value;
    const fPd    = document.getElementById('f-period').value;
    if (fSales) params.set('salespersonId', fSales);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo)   params.set('dateTo', dateTo);
    if (fSt)    params.set('status', fSt);
    if (fTy)    params.set('serviceType', fTy);
    if (fPd)    params.set('scheduledPeriod', fPd);
    if (rangeType) params.set('rangeType', rangeType);

    // Store salesperson name for print header
    const sEl = document.getElementById('f-salesperson');
    const salesName = sEl.options[sEl.selectedIndex]?.text || '';
    if (salesName && fSales) params.set('salespersonName', salesName);

    window._navigate && window._navigate('/print?' + params.toString());
  });

  load();

  // Return cleanup function to unsubscribe from Firestore when navigating away
  return () => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };
}
