/**
 * bookings.js — All Schedules list with filters (Admin / Office Staff)
 */
'use strict';
import { Bookings, Users, ActivityLog } from '../db.js';
import { formatDateTime, formatDate, formatBookingDateTime, serviceBadge, loadingHTML, errorHTML, escapeHtml, debounce, getDateRange, showToast, showModal, exportBookingsToCSV } from '../utils.js';
import { openScheduleModal } from './booking-form.js';

export async function renderBookings(container, appState) {
  const role = appState.user.role;
  const isSales = role === 'salesperson';
  const canDelete = role === 'admin' || role === 'super_admin';

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Schedules</h1>
        <div class="page-subtitle">All schedule records</div>
      </div>
      <div class="page-actions">
        ${!isSales ? `
        <button class="btn btn-secondary" id="export-csv-btn">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Export CSV
        </button>
        <button class="btn btn-secondary" id="print-btn">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          Print
        </button>` : ''}
        <button class="btn btn-primary" id="new-schedule-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Create Schedule
        </button>
      </div>
    </div>

    <!-- Filter Bar -->
    <div class="filter-bar">
      <div class="filter-row">
        <div class="filter-group flex-2">
          <div class="filter-label">Customer / Phone</div>
          <input type="text" id="f-search" class="filter-control" placeholder="Search name or number…">
        </div>
        <div class="filter-group">
          <div class="filter-label">Date Range</div>
          <select id="f-date-range" class="filter-control">
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
            <option>Pending</option><option>Completed</option><option>Others</option><option>Cancelled</option>
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
      <div id="bookings-pagination"></div>
    </div>`;

  // Populate salesperson dropdown
  try {
    const isSuper = role === 'super_admin';
    const salespeople = await Users.getActiveSalespersons(isSuper);
    const sEl = document.getElementById('f-salesperson');
    if (sEl) salespeople.forEach(u => sEl.add(new Option(u.displayName, u.id)));
  } catch(_) {}

  let allBookings = [];
  let filtered    = [];
  let currentPage = 1;
  let pageSize    = 10;
  let unsubscribe = null;

  function isPaginatedRangeSelected() {
    const rangeType = document.getElementById('f-date-range')?.value || 'today';
    return rangeType === 'month' || rangeType === 'all' || rangeType === 'custom';
  }

  function load() {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }

    const searchInput = document.getElementById('f-search');
    const searchVal = (searchInput?.value || '').trim();
    const hasSearch = searchVal.length > 0;

    let dateFrom, dateTo;
    if (hasSearch) {
      // EXCEPTION: When search bar is used, search across ALL dates / all time
      dateFrom = undefined;
      dateTo   = undefined;
    } else {
      const rangeType = document.getElementById('f-date-range')?.value || 'today';
      const customFrom = document.getElementById('f-date-from')?.value || '';
      const customTo = document.getElementById('f-date-to')?.value || '';
      const range = getDateRange(rangeType, customFrom, customTo);
      dateFrom = range.dateFrom;
      dateTo   = range.dateTo;
    }

    const fStatus   = document.getElementById('f-status')?.value;
    const fPeriod   = document.getElementById('f-period')?.value;
    const fSales    = document.getElementById('f-salesperson')?.value;

    const tableEl = document.getElementById('bookings-table');
    if (tableEl && !allBookings.length) {
      tableEl.innerHTML = loadingHTML();
    }

    try {
      unsubscribe = Bookings.onAllSnapshot(
        {
          status:          fStatus   || undefined,
          salespersonId:   fSales    || undefined,
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
    const rawQ = (searchInput?.value || '').trim().toLowerCase();
    const cleanQ = rawQ.replace(/[\s\-\+\(\)]/g, '');

    filtered = rawQ
      ? allBookings.filter(b => {
          const name = (b.snapshot_name || '').toLowerCase();
          const phone = (b.snapshot_contactNumber || '').toLowerCase();
          const cleanPhone = phone.replace(/[\s\-\+\(\)]/g, '');
          const address = (b.snapshot_address || '').toLowerCase();
          const id = (b.id || '').toLowerCase();
          const service = (b.serviceType || '').toLowerCase();
          const details = (b.serviceDetails || '').toLowerCase();
          const notes = (b.notes || '').toLowerCase();
          const sales = (b.salespersonName || '').toLowerCase();
          const bookedBy = (b.bookedByName || '').toLowerCase();
          const reason = (b.statusReason || '').toLowerCase();

          return name.includes(rawQ) ||
                 phone.includes(rawQ) ||
                 (cleanQ && cleanPhone.includes(cleanQ)) ||
                 address.includes(rawQ) ||
                 id.includes(rawQ) ||
                 service.includes(rawQ) ||
                 details.includes(rawQ) ||
                 notes.includes(rawQ) ||
                 sales.includes(rawQ) ||
                 bookedBy.includes(rawQ) ||
                 reason.includes(rawQ);
        })
      : allBookings;

    renderView();
  }

  function renderView() {
    const isPaginated = isPaginatedRangeSelected();
    const countEl = document.getElementById('booking-count');
    const totalItems = filtered.length;

    if (countEl) {
      countEl.innerHTML = `
        <div class="card-title">Schedules</div>
        <div class="text-sm text-secondary">${totalItems} record${totalItems !== 1 ? 's' : ''}${isPaginated && totalItems > 0 ? ` (Paginated: ${pageSize} per page)` : ''}</div>`;
    }

    if (!isPaginated) {
      // Non-paginated view (Today, Yesterday, Tomorrow, This Week, Last Week)
      renderTable(filtered);
      const pagEl = document.getElementById('bookings-pagination');
      if (pagEl) pagEl.innerHTML = '';
      return;
    }

    // Paginated view (This Month, All Time, Custom)
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIdx = (currentPage - 1) * pageSize;
    const endIdx = startIdx + pageSize;
    const pageItems = filtered.slice(startIdx, endIdx);

    renderTable(pageItems);
    renderPagination(totalItems, totalPages);
  }

  function renderTable(list) {
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
            ${list.map(b => {
              const statusSlug = (b.status || 'pending').toLowerCase().replace(/\s+/g, '-');
              return `
              <tr class="clickable row-status-${statusSlug}" data-id="${b.id}" onclick="window._navigate && window._navigate('/schedules/view/${b.id}')">
                <td class="text-sm" style="white-space:nowrap">${formatDate(b.scheduledDate)}</td>
                <td class="text-sm" style="white-space:nowrap">${escapeHtml(b.scheduledTime || '')} <span class="badge badge-gray text-xs" style="margin-left:2px;">${escapeHtml(b.scheduledPeriod || 'Anytime')}</span></td>
                <td><div class="font-medium">${escapeHtml(b.snapshot_name)}</div></td>
                <td class="text-sm text-secondary">${escapeHtml(b.snapshot_contactNumber)}</td>
                <td>${serviceBadge(b.serviceType)}<div class="text-xs text-secondary mt-1">${escapeHtml((b.serviceDetails||'').slice(0,40))}${(b.serviceDetails||'').length>40?'…':''}</div></td>
                <td class="text-sm">${escapeHtml(b.salespersonName || '—')}</td>
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
                  <div class="status-reason-note" id="status-reason-${b.id}" title="${escapeHtml(b.statusReason || '')}">${b.status === 'Others' && b.statusReason ? `“${escapeHtml(b.statusReason)}”` : ''}</div>
                </td>
                <td style="text-align:right" onclick="event.stopPropagation()">
                  <div class="row-actions-stacked">
                    <button class="btn btn-secondary btn-sm" onclick="window._openEditSchedule('${b.id}')">Edit</button>
                    ${canDelete ? `<button class="btn btn-danger-outline btn-sm" onclick="window._deleteSchedule(this, '${b.id}', '${escapeHtml(b.snapshot_name)}')">Delete</button>` : ''}
                  </div>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function renderPagination(totalItems, totalPages) {
    const pagEl = document.getElementById('bookings-pagination');
    if (!pagEl) return;
    if (!totalItems) {
      pagEl.innerHTML = '';
      return;
    }

    const startItem = (currentPage - 1) * pageSize + 1;
    const endItem = Math.min(currentPage * pageSize, totalItems);

    // Build numbered page buttons
    let pageBtns = '';
    const isMobile = window.innerWidth <= 600;
    const maxVisibleBtns = isMobile ? 3 : 5;
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
            <select id="sched-page-size" class="pagination-select-control" aria-label="Items per page">
              <option value="10" ${pageSize === 10 ? 'selected' : ''}>10</option>
              <option value="20" ${pageSize === 20 ? 'selected' : ''}>20</option>
              <option value="50" ${pageSize === 50 ? 'selected' : ''}>50</option>
            </select>
            <span>per page</span>
          </div>
          <div class="pagination-info">
            Showing <strong>${startItem}–${endItem}</strong> of <strong>${totalItems}</strong> schedules
          </div>
        </div>
        <nav class="pagination-nav" aria-label="Schedule list pagination">
          <button class="pagination-btn pagination-btn-extreme" id="sched-first-page" ${currentPage === 1 ? 'disabled' : ''} title="First Page">«</button>
          <button class="pagination-btn" id="sched-prev-page" ${currentPage === 1 ? 'disabled' : ''} title="Previous Page">‹</button>
          ${pageBtns}
          <button class="pagination-btn" id="sched-next-page" ${currentPage === totalPages ? 'disabled' : ''} title="Next Page">›</button>
          <button class="pagination-btn pagination-btn-extreme" id="sched-last-page" ${currentPage === totalPages ? 'disabled' : ''} title="Last Page">»</button>
        </nav>
      </div>
    `;

    // Page size change handler
    pagEl.querySelector('#sched-page-size')?.addEventListener('change', (e) => {
      pageSize = Number(e.target.value);
      currentPage = 1;
      renderView();
    });

    // Navigation buttons
    pagEl.querySelector('#sched-first-page')?.addEventListener('click', () => {
      if (currentPage > 1) { currentPage = 1; renderView(); }
    });
    pagEl.querySelector('#sched-prev-page')?.addEventListener('click', () => {
      if (currentPage > 1) { currentPage--; renderView(); }
    });
    pagEl.querySelector('#sched-next-page')?.addEventListener('click', () => {
      if (currentPage < totalPages) { currentPage++; renderView(); }
    });
    pagEl.querySelector('#sched-last-page')?.addEventListener('click', () => {
      if (currentPage < totalPages) { currentPage = totalPages; renderView(); }
    });

    // Numbered page clicks
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

  async function applyStatusChange(selectEl, id, prevStatus, newStatus, reason = '') {
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

    const reasonEl = document.getElementById(`status-reason-${id}`);
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
            <textarea id="modal-status-reason" class="form-control" rows="3" placeholder="Enter reason here…" autofocus></textarea>
            <div id="modal-status-reason-err" class="form-error" style="display:none;">Please enter a reason.</div>
          </div>
        `,
        confirmText: 'Save Status',
        cancelText: 'Cancel',
        onConfirm: async () => {
          const reasonInput = document.getElementById('modal-status-reason');
          const reason = (reasonInput?.value || '').trim();
          if (!reason) {
            const errEl = document.getElementById('modal-status-reason-err');
            if (errEl) errEl.style.display = 'block';
            if (reasonInput) reasonInput.focus();
            throw new Error('Reason required');
          }
          await applyStatusChange(selectEl, id, prevStatus, newStatus, reason);
        },
        onCancel: () => {
          selectEl.value = prevStatus;
          selectEl.className = `status-select status-select-${prevStatus.toLowerCase().replace(/\s+/g, '-')}`;
        }
      });
      return;
    }

    await applyStatusChange(selectEl, id, prevStatus, newStatus, '');
  };

  // Delete schedule handler with styled confirmation modal
  window._deleteSchedule = (btnEl, id, customerName) => {
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
      }
    });
  };

  // Event bindings
  const filterIds = ['f-status','f-salesperson','f-date-from','f-date-to','f-period'];
  filterIds.forEach(id => document.getElementById(id)?.addEventListener('change', () => {
    currentPage = 1;
    load();
  }));
  
  let prevHasSearch = false;
  const onSearchInput = () => {
    currentPage = 1;
    const q = (document.getElementById('f-search')?.value || '').trim();
    const hasSearch = q.length > 0;
    if (hasSearch !== prevHasSearch) {
      prevHasSearch = hasSearch;
      load(); // Reload query across all dates
    } else {
      applySearch(); // In-memory filter
    }
  };
  document.getElementById('f-search')?.addEventListener('input', debounce(onSearchInput, 200));

  // Date Range dropdown change
  document.getElementById('f-date-range')?.addEventListener('change', (e) => {
    currentPage = 1;
    const isCustom = e.target.value === 'custom';
    const fromGroup = document.getElementById('f-custom-from-group');
    const toGroup = document.getElementById('f-custom-to-group');
    if (fromGroup) fromGroup.style.display = isCustom ? 'flex' : 'none';
    if (toGroup) toGroup.style.display = isCustom ? 'flex' : 'none';
    load();
  });

  document.getElementById('clear-filters-btn')?.addEventListener('click', () => {
    currentPage = 1;
    document.getElementById('f-search').value = '';
    document.getElementById('f-date-range').value = 'today';
    document.getElementById('f-date-from').value = '';
    document.getElementById('f-date-to').value = '';
    document.getElementById('f-custom-from-group').style.display = 'none';
    document.getElementById('f-custom-to-group').style.display = 'none';
    document.getElementById('f-status').value = '';
    document.getElementById('f-period').value = '';
    document.getElementById('f-salesperson').value = '';
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

  // Export to CSV
  document.getElementById('export-csv-btn')?.addEventListener('click', () => {
    exportBookingsToCSV(filtered.length ? filtered : allBookings, 'forex_cargo_schedules');
  });

  document.getElementById('print-btn')?.addEventListener('click', () => {
    // Pass current filter state to print page
    const params = new URLSearchParams();
    const fSales = document.getElementById('f-salesperson').value;
    const rangeType = document.getElementById('f-date-range')?.value || 'today';
    const customFrom = document.getElementById('f-date-from')?.value || '';
    const customTo = document.getElementById('f-date-to')?.value || '';
    const { dateFrom, dateTo } = getDateRange(rangeType, customFrom, customTo);
    const fSt    = document.getElementById('f-status').value;
    const fPd    = document.getElementById('f-period').value;
    if (fSales) params.set('salespersonId', fSales);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo)   params.set('dateTo', dateTo);
    if (fSt)    params.set('status', fSt);
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

