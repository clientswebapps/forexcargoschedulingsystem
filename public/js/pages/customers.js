/**
 * customers.js — Customer Directory page
 */
'use strict';
import { Customers } from '../db.js';
import { showToast, showModal, loadingHTML, errorHTML, escapeHtml, debounce, initials, btnLoading } from '../utils.js';

export async function renderCustomers(container, appState) {
  const canEdit = appState.user.role !== 'salesperson';

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Customer Directory</h1>
        <div class="page-subtitle">Search and manage customer records</div>
      </div>
      <div class="page-actions">
        ${canEdit ? `<button class="btn btn-primary" id="add-customer-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Customer
        </button>` : ''}
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
            ${canEdit ? '<th style="text-align:right">Actions</th>' : ''}
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
                ${canEdit ? `<td style="text-align:right">
                  <button class="btn btn-secondary btn-sm" onclick="window._editCustomer('${c.id}')">Edit</button>
                </td>` : ''}
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  // Search
  const searchFn = debounce(q => {
    if (!q) { renderTable(allCustomers); return; }
    const ql = q.toLowerCase();
    renderTable(allCustomers.filter(c =>
      (c.name || '').toLowerCase().includes(ql) ||
      (c.contactNumber || '').includes(q)
    ));
  }, 250);
  document.getElementById('customer-search')?.addEventListener('input', e => searchFn(e.target.value.trim()));

  // Add customer button
  if (canEdit) {
    document.getElementById('add-customer-btn')?.addEventListener('click', () => showCustomerForm(null));
  }

  window._editCustomer = (id) => {
    const c = allCustomers.find(x => x.id === id);
    if (c) showCustomerForm(c);
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
          showToast('Customer updated.', 'success');
        } else {
          await Customers.create({ name, contactNumber: phone, address });
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
