/**
 * my-schedule.js — Salesperson's own schedule
 * Shows only schedules where salespersonId === current user's UID
 */
'use strict';
import { Bookings, ActivityLog } from '../db.js';
import { formatDateTime, formatDate, formatBookingDateTime, statusBadge, serviceBadge, loadingHTML, errorHTML, escapeHtml, debounce, getDateRange, showToast, showModal, exportBookingsToCSV } from '../utils.js';
import { openScheduleModal } from './booking-form.js';

export async function renderMySchedule(container, appState) {
  const uid = appState.uid;
  const role = appState.user.role;
  const isSales = role === 'salesperson';

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">My Schedule</h1>
        <div class="page-subtitle">Your assigned schedules</div>
      </div>
      <div class="page-actions">
        ${!isSales ? `
        <button class="btn btn-secondary" id="my-export-csv-btn">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Export CSV
        </button>
        <button class="btn btn-secondary" id="my-print-btn">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          Print My Schedule
        </button>` : ''}
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
            <option value="yesterday">Yesterday</option>
            <option value="tomorrow">Tomorrow</option>
            <option value="week">This Week</option>
            <option value="last_week">Last Week</option>
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
            <option>Pending</option><option>Completed</option><option>Others</option><option>Cancelled</option>
          </select>
        </div>

        <div class="filter-group flex-2">
          <div class="filter-label">Search (customer name or number)</div>
          <input type="text" id="ms-search" class="filter-control" placeholder="Search name or contact…">
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
  let filtered    = [];
  let unsubscribe = null;

  function load() {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }

    const searchInput = document.getElementById('ms-search');
    const searchVal = (searchInput?.value || '').trim();
    const hasSearch = searchVal.length > 0;

    let dateFrom, dateTo;
    if (hasSearch) {
      // EXCEPTION: When searching, search across ALL dates / all time
      dateFrom = undefined;
      dateTo   = undefined;
    } else {
      const rangeType = document.getElementById('ms-date-range')?.value || 'today';
      const customFrom = document.getElementById('ms-date-from')?.value || '';
      const customTo = document.getElementById('ms-date-to')?.value || '';
      const range = getDateRange(rangeType, customFrom, customTo);
      dateFrom = range.dateFrom;
      dateTo   = range.dateTo;
    }

    const fStatus = document.getElementById('ms-status')?.value;
    const fPeriod = document.getElementById('ms-period')?.value;

    const tableEl = document.getElementById('ms-table');
    if (tableEl && !allBookings.length) {
      tableEl.innerHTML = loadingHTML();
    }

    try {
      unsubscribe = Bookings.onMineSnapshot(
        uid,
        {
          status:          fStatus || undefined,
          dateFrom:        dateFrom || undefined,
          dateTo:          dateTo || undefined,
          scheduledPeriod: fPeriod || undefined,
        },
        (records) => {
          allBookings = records;
          applySearch();
        },
        (err) => {
          const el = document.getElementById('ms-table');
          if (el) el.innerHTML = errorHTML('Failed to sync schedules in real time: ' + (err.message || err));
        }
      );
    } catch (err) {
      if (tableEl) tableEl.innerHTML = errorHTML('Failed to load schedules.');
    }
  }

  function applySearch() {
    const rawQ = (document.getElementById('ms-search')?.value || '').trim().toLowerCase();
    const cleanQ = rawQ.replace(/[\s\-\+\(\)]/g, '');

    filtered = allBookings.filter(b => {
      if (rawQ) {
        const name = (b.snapshot_name || '').toLowerCase();
        const phone = (b.snapshot_contactNumber || '').toLowerCase();
        const cleanPhone = phone.replace(/[\s\-\+\(\)]/g, '');
        const address = (b.snapshot_address || '').toLowerCase();
        const id = (b.id || '').toLowerCase();
        const service = (b.serviceType || '').toLowerCase();
        const details = (b.serviceDetails || '').toLowerCase();
        const notes = (b.notes || '').toLowerCase();
        const reason = (b.statusReason || '').toLowerCase();

        return name.includes(rawQ) ||
               phone.includes(rawQ) ||
               (cleanQ && cleanPhone.includes(cleanQ)) ||
               address.includes(rawQ) ||
               id.includes(rawQ) ||
               service.includes(rawQ) ||
               details.includes(rawQ) ||
               notes.includes(rawQ) ||
               reason.includes(rawQ);
      }
      return true;
    });

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
              const statusSlug = (b.status || 'pending').toLowerCase().replace(/\s+/g, '-');
              return `
              <tr class="clickable row-status-${statusSlug}" data-id="${b.id}" onclick="window._navigate('/schedules/view/${b.id}')">
                <td class="text-sm" style="white-space:nowrap">${formatDate(b.scheduledDate)}</td>
                <td class="text-sm" style="white-space:nowrap">${escapeHtml(b.scheduledTime || '')} <span class="badge badge-gray text-xs" style="margin-left: 2px;">${escapeHtml(b.scheduledPeriod || 'Anytime')}</span></td>
                <td><div class="font-medium">${escapeHtml(b.snapshot_name)}</div>
                    <div class="text-xs text-secondary">${escapeHtml(b.snapshot_address || '')}</div></td>
                <td class="text-sm">${escapeHtml(b.snapshot_contactNumber)}</td>
                <td>${serviceBadge(b.serviceType)}
                    <div class="text-xs text-secondary mt-1">${escapeHtml((b.serviceDetails||'').slice(0,30))}${(b.serviceDetails||'').length>30?'…':''}</div></td>
                <td class="text-sm text-secondary">${escapeHtml(b.bookedByName || '—')}</td>
                <td onclick="event.stopPropagation()">
                  <select class="status-select status-select-${statusSlug}"
                    data-id="${b.id}"
                    data-current="${b.status}"
                    onchange="window._updateScheduleStatus(this, '${b.id}', this.getAttribute('data-current') || '${b.status}')">
                    <option value="Pending" ${b.status === 'Pending' ? 'selected' : ''}>Pending</option>
                    <option value="Completed" ${b.status === 'Completed' ? 'selected' : ''}>Completed</option>
                    <option value="Others" ${b.status === 'Others' ? 'selected' : ''}>Others</option>
                    <option value="Cancelled" ${b.status === 'Cancelled' ? 'selected' : ''}>Cancelled</option>
                  </select>
                  <div class="status-reason-note" id="ms-status-reason-${b.id}" title="${escapeHtml(b.statusReason || '')}">${b.status === 'Others' && b.statusReason ? `“${escapeHtml(b.statusReason)}”` : ''}</div>
                </td>
                <td style="text-align:right" onclick="event.stopPropagation()">
                  ${isOwnBooking ? `
                    <div class="row-actions-stacked">
                      <button class="btn btn-secondary btn-sm" onclick="window._openEditSchedule('${b.id}')">Edit</button>
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

  let prevHasMsSearch = false;
  const onMsSearchInput = () => {
    const q1 = (document.getElementById('ms-search')?.value || '').trim();
    const hasSearch = q1.length > 0;
    if (hasSearch !== prevHasMsSearch) {
      prevHasMsSearch = hasSearch;
      load(); // Reload query across all dates
    } else {
      applySearch(); // In-memory filter
    }
  };
  document.getElementById('ms-search')?.addEventListener('input', debounce(onMsSearchInput, 200));

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
    document.getElementById('ms-search').value = '';
    document.getElementById('ms-date-range').value = 'today';
    document.getElementById('ms-date-from').value = '';
    document.getElementById('ms-date-to').value   = '';
    document.getElementById('ms-custom-from-group').style.display = 'none';
    document.getElementById('ms-custom-to-group').style.display = 'none';
    document.getElementById('ms-status').value    = '';
    document.getElementById('ms-period').value    = '';
    load();
  });

  // Create Schedule opens modal
  document.getElementById('my-new-schedule-btn')?.addEventListener('click', () => {
    openScheduleModal(appState, null);
  });

  // Export My Schedule to CSV
  document.getElementById('my-export-csv-btn')?.addEventListener('click', () => {
    const sName = (appState.user.displayName || 'salesperson').replace(/\s+/g, '_').toLowerCase();
    exportBookingsToCSV(allBookings, `forex_schedule_${sName}`);
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

  async function applyMyScheduleStatusChange(selectEl, id, prevStatus, newStatus, reason = '') {
    const newSlug = newStatus.toLowerCase().replace(/\s+/g, '-');
    const prevSlug = prevStatus.toLowerCase().replace(/\s+/g, '-');

    const rowEl = selectEl.closest('tr');
    if (rowEl) {
      rowEl.classList.remove(`row-status-${prevSlug}`);
      rowEl.classList.add(`row-status-${newSlug}`);
    }
    selectEl.className = `status-select status-select-${newSlug}`;
    selectEl.setAttribute('data-current', newStatus);
    selectEl.disabled = true;

    const reasonEl = document.getElementById(`ms-status-reason-${id}`);
    if (reasonEl) {
      reasonEl.textContent = (newStatus === 'Others' && reason) ? `“${reason}”` : '';
      reasonEl.title = (newStatus === 'Others' && reason) ? reason : '';
    }

    try {
      await Bookings.updateStatus(id, newStatus, reason);
      try {
        await ActivityLog.write({
          bookingId: id,
          action: 'STATUS_CHANGED',
          details: { from: prevStatus, to: newStatus, ...(reason ? { reason } : {}) }
        });
      } catch (_) {}
      showToast(`Status updated to ${newStatus}.`, 'success');
    } catch (err) {
      console.error('Failed to update status:', err);
      selectEl.value = prevStatus;
      selectEl.className = `status-select status-select-${prevSlug}`;
      selectEl.setAttribute('data-current', prevStatus);
      if (rowEl) {
        rowEl.classList.remove(`row-status-${newSlug}`);
        rowEl.classList.add(`row-status-${prevSlug}`);
      }
      if (reasonEl) {
        reasonEl.textContent = '';
      }
      showToast('Failed to update status: ' + (err.message || ''), 'error');
    } finally {
      selectEl.disabled = false;
    }
  }

  // Inline status change handler with reason prompt modal for "Others"
  window._updateScheduleStatus = async (selectEl, id, prevStatus) => {
    const newStatus = selectEl.value;
    if (newStatus === prevStatus) return;

    if (newStatus === 'Others') {
      showModal({
        title: 'Specify Reason for "Others"',
        body: `
          <p style="font-size:0.875rem;color:var(--text-secondary);margin-bottom:12px;">
            Please define the reason for setting this schedule to <strong>Others</strong> (e.g. Customer not answering call, rescheduled, out of country, etc.):
          </p>
          <div class="form-group" style="margin-bottom:0">
            <textarea id="ms-modal-status-reason" class="form-control" rows="3" placeholder="Enter reason here…" autofocus></textarea>
            <div id="ms-modal-status-reason-err" class="form-error" style="display:none;">Please enter a reason.</div>
          </div>
        `,
        confirmText: 'Save Status',
        cancelText: 'Cancel',
        onConfirm: async () => {
          const reasonInput = document.getElementById('ms-modal-status-reason');
          const reason = (reasonInput?.value || '').trim();
          if (!reason) {
            const errEl = document.getElementById('ms-modal-status-reason-err');
            if (errEl) errEl.style.display = 'block';
            if (reasonInput) reasonInput.focus();
            throw new Error('Reason required');
          }
          await applyMyScheduleStatusChange(selectEl, id, prevStatus, newStatus, reason);
        },
        onCancel: () => {
          selectEl.value = prevStatus;
          selectEl.className = `status-select status-select-${prevStatus.toLowerCase().replace(/\s+/g, '-')}`;
        }
      });
      return;
    }

    await applyMyScheduleStatusChange(selectEl, id, prevStatus, newStatus, '');
  };

  // Action handlers for edit/delete
  window._openEditSchedule = (id) => {
    openScheduleModal(appState, id);
  };

  window._deleteMySchedule = (btnEl, id, customerName) => {
    showModal({
      title: 'Delete Schedule',
      body: `<p>Are you sure you want to delete the schedule for <strong>${escapeHtml(customerName)}</strong>?</p>
             <p class="text-xs text-secondary mt-1">This action cannot be undone.</p>`,
      confirmText: 'Delete Schedule',
      cancelText: 'Cancel',
      danger: true,
      onConfirm: async () => {
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
      }
    });
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
