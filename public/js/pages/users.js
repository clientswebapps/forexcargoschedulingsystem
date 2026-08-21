/**
 * users.js — User Management page (Admin only)
 * Creates users via Firebase Auth REST API + Firestore
 */
'use strict';
import { Users, AuthREST } from '../db.js';
import { showToast, showModal, roleBadge, roleLabel, initials, loadingHTML, errorHTML, escapeHtml, btnLoading } from '../utils.js';

export async function renderUsers(container, appState) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">User Management</h1>
        <div class="page-subtitle">Manage staff accounts and roles</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" id="add-user-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add User
        </button>
      </div>
    </div>
    <div class="card">
      <div class="card-header">
        <div class="card-title">All Staff</div>
        <div>
          <input type="text" id="user-search" class="filter-control" placeholder="Search by name or email…" style="width:220px;">
        </div>
      </div>
      <div id="users-table">${loadingHTML()}</div>
    </div>`;

  let allUsers = [];
  let unsubscribe = null;

  function load() {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    const tableEl = document.getElementById('users-table');
    if (tableEl && !allUsers.length) {
      tableEl.innerHTML = loadingHTML();
    }
    try {
      unsubscribe = Users.onSnapshot((list) => {
        allUsers = list;
        applySearch();
      });
    } catch (err) {
      if (tableEl) tableEl.innerHTML = errorHTML('Failed to load users.');
    }
  }

  function renderTable(users) {
    const el = document.getElementById('users-table');
    if (!users.length) {
      el.innerHTML = `<div class="table-empty">No users found.</div>`;
      return;
    }
    el.innerHTML = `
      <div class="table-wrapper" style="border-radius:0;border:none;box-shadow:none;">
        <table>
          <thead><tr>
            <th>Name</th><th>Email</th><th>Role</th><th>Status</th><th style="text-align:right">Actions</th>
          </tr></thead>
          <tbody>
            ${users.map(u => `
              <tr>
                <td>
                  <div class="flex items-center gap-2">
                    <div class="avatar" style="background:${avatarColor(u.role)}">${initials(u.displayName)}</div>
                    <span class="font-medium">${escapeHtml(u.displayName || '—')}</span>
                    ${u.id === appState.uid ? '<span class="badge badge-gray text-xs">You</span>' : ''}
                  </div>
                </td>
                <td class="text-sm text-secondary">${escapeHtml(u.email || '—')}</td>
                <td>${roleBadge(u.role)}</td>
                <td>
                  <span class="flex items-center gap-1 text-sm">
                    <span class="status-dot ${u.isActive ? 'active' : 'inactive'}"></span>
                    ${u.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td style="text-align:right">
                  <div class="flex gap-2 justify-end">
                    <button class="btn btn-secondary btn-sm" onclick="window._editUser('${u.id}')">
                      Edit
                    </button>
                    ${u.id !== appState.uid ? `
                    <button class="btn btn-sm ${u.isActive ? 'btn-danger' : 'btn-ghost'}" onclick="window._toggleUser('${u.id}', ${u.isActive})">
                      ${u.isActive ? 'Deactivate' : 'Activate'}
                    </button>` : ''}
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  // Search
  function applySearch() {
    const q = (document.getElementById('user-search')?.value || '').toLowerCase();
    renderTable(q ? allUsers.filter(u =>
      (u.displayName||'').toLowerCase().includes(q) ||
      (u.email||'').toLowerCase().includes(q)
    ) : allUsers);
  }

  document.getElementById('user-search').addEventListener('input', applySearch);

  // Add user
  document.getElementById('add-user-btn').addEventListener('click', () => showUserForm(null));

  // Global handlers
  window._editUser = (uid) => {
    const user = allUsers.find(u => u.id === uid);
    if (user) showUserForm(user);
  };

  window._toggleUser = (uid, currentlyActive) => {
    const action = currentlyActive ? 'deactivate' : 'activate';
    const user = allUsers.find(u => u.id === uid);
    showModal({
      title: `${currentlyActive ? 'Deactivate' : 'Activate'} User`,
      body: `<p>Are you sure you want to ${action} <strong>${escapeHtml(user?.displayName || uid)}</strong>?
             ${currentlyActive ? 'They will no longer be able to sign in.' : 'They will be able to sign in again.'}</p>`,
      confirmText: currentlyActive ? 'Deactivate' : 'Activate',
      cancelText: 'Cancel',
      danger: currentlyActive,
      onConfirm: async () => {
        await Users.update(uid, { isActive: !currentlyActive });
        showToast(`User ${action}d successfully.`, 'success');
        load();
      }
    });
  };

  async function showUserForm(user) {
    const isEdit = !!user;
    showModal({
      title: isEdit ? 'Edit User' : 'Add New User',
      wide: true,
      body: `
        <div class="form-group">
          <label class="form-label required" for="uf-name">Display Name</label>
          <input type="text" id="uf-name" class="form-control" value="${escapeHtml(user?.displayName || '')}" placeholder="Full name">
        </div>
        ${!isEdit ? `
        <div class="form-row">
          <div class="form-group">
            <label class="form-label required" for="uf-email">Email Address</label>
            <input type="email" id="uf-email" class="form-control" placeholder="user@forexcargo.bh">
          </div>
          <div class="form-group">
            <label class="form-label required" for="uf-password">Password</label>
            <input type="password" id="uf-password" class="form-control" placeholder="Minimum 8 characters">
          </div>
        </div>` : `
        <div class="form-group">
          <label class="form-label" for="uf-email">Email Address</label>
          <input type="text" id="uf-email" class="form-control form-control-readonly" value="${escapeHtml(user?.email || '')}" readonly>
        </div>`}
        <div class="form-group">
          <label class="form-label required" for="uf-role">Role</label>
          <select id="uf-role" class="form-control">
            <option value="admin"        ${user?.role==='admin'?'selected':''}>Admin</option>
            <option value="office_staff" ${user?.role==='office_staff'?'selected':''}>Office Staff</option>
            <option value="salesperson"  ${user?.role==='salesperson'?'selected':''}>Salesperson</option>
          </select>
        </div>
        <div id="uf-err" class="form-error hidden"></div>`,
      confirmText: isEdit ? 'Save Changes' : 'Create User',
      cancelText: 'Cancel',
      onConfirm: async () => {
        const name     = document.getElementById('uf-name').value.trim();
        const roleVal  = document.getElementById('uf-role').value;
        const errEl    = document.getElementById('uf-err');

        if (!name) { errEl.textContent = 'Display name is required.'; errEl.classList.remove('hidden'); throw new Error('validation'); }

        if (isEdit) {
          await Users.update(user.id, { displayName: name, role: roleVal });
          showToast('User updated successfully.', 'success');
        } else {
          const email    = document.getElementById('uf-email').value.trim();
          const password = document.getElementById('uf-password').value;
          if (!email || !password) { errEl.textContent = 'Email and password are required.'; errEl.classList.remove('hidden'); throw new Error('validation'); }
          if (password.length < 8) { errEl.textContent = 'Password must be at least 8 characters.'; errEl.classList.remove('hidden'); throw new Error('validation'); }

          // Create Firebase Auth account via REST (no session change)
          const { uid: newUid, idToken } = await AuthREST.createUser(email, password);
          // Set display name
          await AuthREST.updateDisplayName(idToken, name);
          // Create Firestore document
          await Users.create(newUid, { displayName: name, email, role: roleVal });
          showToast('User created successfully.', 'success');
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

function avatarColor(role) {
  const map = { admin: 'rgba(13,71,161,0.15)', office_staff: 'rgba(25,118,210,0.12)', salesperson: '#EEEEEE' };
  return map[role] || '#EEEEEE';
}
