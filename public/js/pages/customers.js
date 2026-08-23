/**
 * customers.js — Customer Directory page
 */
'use strict';
import { Customers, ActivityLog } from '../db.js';
import { openScheduleModal } from './booking-form.js';
import { showToast, showModal, loadingHTML, errorHTML, escapeHtml, debounce, initials, btnLoading } from '../utils.js';

export async function renderCustomers(container, appState) {
  const role = appState.user.role;
  const canDelete = role === 'admin' || role === 'super_admin';

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Customer Directory</h1>
        <div class="page-subtitle">Search and manage customer records</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" id="add-customer-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Customer
        </button>
      </div>
    </div>
    <div class="card">
      <div class="card-header">
        <div class="card-title">All Customers</div>
        <div>
          <input type="text" id="customer-search" class="filter-control" placeholder="Search by name or phone…" style="width:240px;">
        </div>
      </div>
      <div id="customers-table">${loadingHTML()}</div>
    </div>`;

  let allCustomers = [];
  let unsubscribe = null;

  function load() {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    const tableEl = document.getElementById('customers-table');
    if (tableEl && !allCustomers.length) {
      tableEl.innerHTML = loadingHTML();
    }
    try {
      unsubscribe = Customers.onSnapshot((list) => {
        allCustomers = list;
        const q = (document.getElementById('customer-search')?.value || '').trim();
        if (q) searchFn(q);
        else renderTable(allCustomers);
      });
    } catch (err) {
      if (tableEl) tableEl.innerHTML = errorHTML('Failed to load customers.');
    }
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

  // Search with space-tolerant and digit-normalized phone matching
  const searchFn = debounce(q => {
    if (!q) { renderTable(allCustomers); return; }
    const rawQ = q.trim().toLowerCase();
    const cleanQ = rawQ.replace(/[\s\-\+\(\)]/g, '');
    const cleanDigitsOnly = rawQ.replace(/\D/g, '');
    let searchLocal = cleanDigitsOnly;
    if (cleanDigitsOnly.startsWith('973') && cleanDigitsOnly.length > 3) {
      searchLocal = cleanDigitsOnly.substring(3);
    }

    renderTable(allCustomers.filter(c => {
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
    }));
  }, 250);
  document.getElementById('customer-search')?.addEventListener('input', e => searchFn(e.target.value.trim()));

  // Add customer button
  document.getElementById('add-customer-btn')?.addEventListener('click', () => showCustomerForm(null));

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
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };
}
