/**
 * customers.js — Customer Directory page
 */
'use strict';
import { Customers, Bookings, ActivityLog } from '../db.js';
import { openScheduleModal } from './booking-form.js';
import { showToast, showModal, loadingHTML, errorHTML, escapeHtml, debounce, initials, btnLoading, exportCustomersToCSV } from '../utils.js';

export async function renderCustomers(container, appState) {
  const role = appState.user.role;
  const uid  = appState.uid;
  const isSales = role === 'salesperson';
  const canDelete = role === 'admin' || role === 'super_admin';
  const canExport = role === 'admin' || role === 'super_admin';

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">${isSales ? 'My Customers' : 'Customer Directory'}</h1>
        <div class="page-subtitle">${isSales ? 'Customers you created or have scheduled jobs with' : 'Search and manage customer records'}</div>
      </div>
      <div class="page-actions">
        ${canExport ? `
        <button class="btn btn-secondary" id="export-customers-csv-btn">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Export CSV
        </button>` : ''}
        <button class="btn btn-primary" id="add-customer-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Customer
        </button>
      </div>
    </div>
    <div class="card">
      <div class="card-header">
        <div class="flex items-center gap-2">
          <div class="card-title">${isSales ? 'My Customers' : 'All Customers'}</div>
          <span class="badge" id="customer-count-badge" style="background:var(--light-blue-50);color:var(--navy);font-weight:600;font-size:0.75rem;padding:2px 8px;border-radius:var(--radius-full);">0</span>
        </div>
        <div>
          <input type="text" id="customer-search" class="filter-control" placeholder="Search by name or phone…" style="width:240px;">
        </div>
      </div>
      <div id="customers-table">${loadingHTML()}</div>
      <div id="customers-pagination"></div>
    </div>`;

  let allRawCustomers = [];
  let salespersonBookings = [];
  let allCustomers = [];
  let filteredCustomers = [];
  let currentPage = 1;
  let pageSize = 10;
  let unsubscribeCustomers = null;
  let unsubscribeBookings  = null;

  function computeScopedCustomers() {
    if (!isSales) {
      allCustomers = allRawCustomers;
      return;
    }

    const assignedCustomerIds = new Set();
    const assignedPhones = new Set();

    salespersonBookings.forEach(b => {
      if (b.customerId) assignedCustomerIds.add(b.customerId);
      if (b.snapshot_contactNumber) {
        const clean = b.snapshot_contactNumber.replace(/\D/g, '');
        if (clean) assignedPhones.add(clean);
        if (clean.startsWith('973') && clean.length > 3) {
          assignedPhones.add(clean.substring(3));
        }
      }
    });

    allCustomers = allRawCustomers.filter(c => {
      if (c.createdBy === uid) return true;
      if (assignedCustomerIds.has(c.id)) return true;
      if (c.contactNumber) {
        const clean = c.contactNumber.replace(/\D/g, '');
        if (clean && (assignedPhones.has(clean) || (clean.startsWith('973') && clean.length > 3 && assignedPhones.has(clean.substring(3))))) {
          return true;
        }
      }
      return false;
    });
  }

  function load() {
    if (unsubscribeCustomers) {
      unsubscribeCustomers();
      unsubscribeCustomers = null;
    }
    if (unsubscribeBookings) {
      unsubscribeBookings();
      unsubscribeBookings = null;
    }

    const tableEl = document.getElementById('customers-table');
    if (tableEl && !allCustomers.length) {
      tableEl.innerHTML = loadingHTML();
    }

    try {
      unsubscribeCustomers = Customers.onSnapshot((list) => {
        allRawCustomers = list;
        computeScopedCustomers();
        updateView();
      });

      if (isSales && uid) {
        unsubscribeBookings = Bookings.onMineSnapshot(uid, {}, (mineList) => {
          salespersonBookings = mineList;
          computeScopedCustomers();
          updateView();
        });
      }
    } catch (err) {
      if (tableEl) tableEl.innerHTML = errorHTML('Failed to load customers.');
    }
  }

  function filterCustomers(list, q) {
    if (!q) return list;
    const rawQ = q.trim().toLowerCase();
    const cleanQ = rawQ.replace(/[\s\-\+\(\)]/g, '');
    const cleanDigitsOnly = rawQ.replace(/\D/g, '');
    let searchLocal = cleanDigitsOnly;
    if (cleanDigitsOnly.startsWith('973') && cleanDigitsOnly.length > 3) {
      searchLocal = cleanDigitsOnly.substring(3);
    }

    return list.filter(c => {
      const name = (c.name || '').toLowerCase();
      const phone = (c.contactNumber || '').toLowerCase();
      const cleanPhone = phone.replace(/[\s\-\+\(\)]/g, '');
      const custDigits = phone.replace(/\D/g, '');
      let custLocal = custDigits;
      if (custDigits.startsWith('973') && custDigits.length > 3) {
        custLocal = custDigits.substring(3);
      }
      const address = (c.address || '').toLowerCase();

      return name.includes(rawQ) ||
             phone.includes(rawQ) ||
             (cleanQ && cleanPhone.includes(cleanQ)) ||
             (searchLocal && custLocal && (custLocal.includes(searchLocal) || searchLocal.includes(custLocal))) ||
             address.includes(rawQ);
    });
  }

  function updateView() {
    const q = (document.getElementById('customer-search')?.value || '').trim();
    filteredCustomers = filterCustomers(allCustomers, q);

    // Update count badge
    const badge = document.getElementById('customer-count-badge');
    if (badge) {
      if (q) {
        badge.textContent = `${filteredCustomers.length} of ${allCustomers.length}`;
        badge.title = `${filteredCustomers.length} filtered from ${allCustomers.length} total customers`;
      } else {
        badge.textContent = `${allCustomers.length}`;
        badge.title = `${allCustomers.length} total customers`;
      }
    }

    const totalItems = filteredCustomers.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIdx = (currentPage - 1) * pageSize;
    const endIdx = startIdx + pageSize;
    const pageItems = filteredCustomers.slice(startIdx, endIdx);

    renderTable(pageItems);
    renderPagination(totalItems, totalPages);
  }

  function renderTable(list) {
    const el = document.getElementById('customers-table');
    if (!el) return;
    if (!list.length) {
      el.innerHTML = `<div class="table-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        No customers found.</div>`;
      return;
    }
    el.innerHTML = `
      <div class="table-wrapper" style="border-radius:0;border:none;box-shadow:none;">
        <table>
          <thead><tr>
            <th>Name</th><th>Contact Number</th><th>Address</th>
            <th style="text-align:right">Actions</th>
          </tr></thead>
          <tbody>
            ${list.map(c => `
              <tr>
                <td>
                  <div class="flex items-center gap-2">
                    <div class="avatar" style="background:var(--light-blue-50);color:var(--blue);">${initials(c.name)}</div>
                    <span class="font-medium">${escapeHtml(c.name)}</span>
                  </div>
                </td>
                <td class="font-medium text-sm">${escapeHtml(c.contactNumber)}</td>
                <td class="text-sm text-secondary">${escapeHtml(c.address || '—')}</td>
                <td style="text-align:right">
                  <div style="display:inline-flex;align-items:center;gap:6px;">
                    <button class="btn btn-primary btn-sm" onclick="window._scheduleCustomer('${c.id}')" title="Create schedule for this customer" style="padding:4px 9px;font-size:0.75rem;display:inline-flex;align-items:center;gap:4px;">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                      Schedule
                    </button>
                    <button class="btn btn-secondary btn-sm" onclick="window._editCustomer('${c.id}')" title="Edit customer details" style="padding:4px 8px;font-size:0.75rem;">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      Edit
                    </button>
                    ${canDelete ? `
                      <button class="btn btn-danger-outline btn-sm" onclick="window._deleteCustomer('${c.id}')" title="Delete customer" style="padding:4px 8px;font-size:0.75rem;">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                        Delete
                      </button>
                    ` : ''}
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function renderPagination(totalItems, totalPages) {
    const pagEl = document.getElementById('customers-pagination');
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
            <select id="cust-page-size" class="pagination-select-control" aria-label="Items per page">
              <option value="10" ${pageSize === 10 ? 'selected' : ''}>10</option>
              <option value="20" ${pageSize === 20 ? 'selected' : ''}>20</option>
              <option value="50" ${pageSize === 50 ? 'selected' : ''}>50</option>
            </select>
            <span>per page</span>
          </div>
          <div class="pagination-info">
            Showing <strong>${startItem}–${endItem}</strong> of <strong>${totalItems}</strong> customers
          </div>
        </div>
        <nav class="pagination-nav" aria-label="Customer list pagination">
          <button class="pagination-btn pagination-btn-extreme" id="cust-first-page" ${currentPage === 1 ? 'disabled' : ''} title="First Page">«</button>
          <button class="pagination-btn" id="cust-prev-page" ${currentPage === 1 ? 'disabled' : ''} title="Previous Page">‹</button>
          ${pageBtns}
          <button class="pagination-btn" id="cust-next-page" ${currentPage === totalPages ? 'disabled' : ''} title="Next Page">›</button>
          <button class="pagination-btn pagination-btn-extreme" id="cust-last-page" ${currentPage === totalPages ? 'disabled' : ''} title="Last Page">»</button>
        </nav>
      </div>
    `;

    // Page size change handler
    pagEl.querySelector('#cust-page-size')?.addEventListener('change', (e) => {
      pageSize = Number(e.target.value);
      currentPage = 1;
      updateView();
    });

    // Navigation buttons
    pagEl.querySelector('#cust-first-page')?.addEventListener('click', () => {
      if (currentPage > 1) { currentPage = 1; updateView(); }
    });
    pagEl.querySelector('#cust-prev-page')?.addEventListener('click', () => {
      if (currentPage > 1) { currentPage--; updateView(); }
    });
    pagEl.querySelector('#cust-next-page')?.addEventListener('click', () => {
      if (currentPage < totalPages) { currentPage++; updateView(); }
    });
    pagEl.querySelector('#cust-last-page')?.addEventListener('click', () => {
      if (currentPage < totalPages) { currentPage = totalPages; updateView(); }
    });

    // Numbered buttons
    pagEl.querySelectorAll('.pagination-btn[data-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = Number(btn.getAttribute('data-page'));
        if (p && p !== currentPage) {
          currentPage = p;
          updateView();
        }
      });
    });
  }

  // Search with space-tolerant and digit-normalized phone matching
  const searchFn = debounce(() => {
    currentPage = 1;
    updateView();
  }, 250);
  document.getElementById('customer-search')?.addEventListener('input', searchFn);

  // Add customer button
  document.getElementById('add-customer-btn')?.addEventListener('click', () => showCustomerForm(null));

  // Export CSV button (Admin / Super Admin only)
  if (canExport) {
    document.getElementById('export-customers-csv-btn')?.addEventListener('click', async () => {
      const listToExport = filteredCustomers.length ? filteredCustomers : allCustomers;
      const success = exportCustomersToCSV(listToExport, 'forex_cargo_customers');
      if (success) {
        try {
          await ActivityLog.write({
            action: 'CUSTOMER_EXPORTED',
            details: { count: listToExport.length }
          });
        } catch (_) {}
      }
    });
  }

  window._editCustomer = (id) => {
    const c = allCustomers.find(x => x.id === id);
    if (c) showCustomerForm(c);
  };

  window._scheduleCustomer = (id) => {
    const c = allCustomers.find(x => x.id === id);
    if (!c) return;
    openScheduleModal(appState, null, null, c);
  };

  window._deleteCustomer = (id) => {
    const c = allCustomers.find(x => x.id === id);
    if (!c) return;

    showModal({
      title: 'Delete Customer',
      body: `<p>Are you sure you want to delete customer <strong>${escapeHtml(c.name)}</strong> (${escapeHtml(c.contactNumber)})?</p>
             <p class="text-xs text-secondary mt-1">This action cannot be undone.</p>`,
      confirmText: 'Delete Customer',
      cancelText: 'Cancel',
      danger: true,
      onConfirm: async () => {
        await Customers.delete(id);
        try {
          await ActivityLog.write({
            action: 'CUSTOMER_DELETED',
            details: { customerId: id, customerName: c.name, phone: c.contactNumber }
          });
        } catch (_) {}
        showToast(`Customer "${c.name}" deleted.`, 'success');
      }
    });
  };

  function showCustomerForm(customer) {
    const isEdit = !!customer;
    showModal({
      title: isEdit ? 'Edit Customer' : 'Add Customer',
      body: `
        <div class="form-group">
          <label class="form-label required" for="cf-name">Customer Name</label>
          <input type="text" id="cf-name" class="form-control" value="${escapeHtml(customer?.name || '')}" placeholder="Full name">
        </div>
        <div class="form-group">
          <label class="form-label required" for="cf-phone">Contact Number</label>
          <input type="tel" id="cf-phone" class="form-control" value="${escapeHtml(customer?.contactNumber || '')}" placeholder="+973 XXXX XXXX">
        </div>
        <div class="form-group">
          <label class="form-label" for="cf-address">Address</label>
          <textarea id="cf-address" class="form-control" rows="2" placeholder="Street, Area, City">${escapeHtml(customer?.address || '')}</textarea>
        </div>
        <div id="cf-err" class="form-error hidden"></div>`,
      confirmText: isEdit ? 'Save Changes' : 'Add Customer',
      onConfirm: async () => {
        const name    = document.getElementById('cf-name').value.trim();
        const phone   = document.getElementById('cf-phone').value.trim();
        const address = document.getElementById('cf-address').value.trim();
        const errEl   = document.getElementById('cf-err');

        if (!name || !phone) {
          errEl.textContent = 'Name and contact number are required.';
          errEl.classList.remove('hidden');
          throw new Error('validation');
        }

        if (isEdit) {
          await Customers.update(customer.id, { name, contactNumber: phone, address });
          try {
            await ActivityLog.write({
              action: 'CUSTOMER_UPDATED',
              details: { customerId: customer.id, customerName: name, phone }
            });
          } catch (_) {}
          showToast('Customer updated.', 'success');
        } else {
          const newCust = await Customers.create({ name, contactNumber: phone, address });
          try {
            await ActivityLog.write({
              action: 'CUSTOMER_CREATED',
              details: { customerId: newCust.id, customerName: name, phone }
            });
          } catch (_) {}
          showToast('Customer added.', 'success');
        }
      }
    });
  }

  load();

  return () => {
    if (unsubscribeCustomers) {
      unsubscribeCustomers();
      unsubscribeCustomers = null;
    }
    if (unsubscribeBookings) {
      unsubscribeBookings();
      unsubscribeBookings = null;
    }
  };
}


