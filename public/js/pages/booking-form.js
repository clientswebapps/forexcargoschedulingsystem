/**
 * booking-form.js — Create / Edit Schedule modal popup
 */
'use strict';
import { Bookings, Customers, Users, ActivityLog, Notifications } from '../db.js';
import { showToast, loadingHTML, errorHTML, escapeHtml, debounce, inputToTimestamp, tsToDateInput, formatTimePart, getBookingPeriod, formatDate, serviceBadge, btnLoading, closeModal } from '../utils.js';

/**
 * Opens the schedule form as a modal popup.
 * If bookingId is provided, it opens in edit mode.
 * onSaved callback is called after successful save (to refresh lists).
 */
export async function openScheduleModal(appState, bookingId = null, onSaved = null, prefillCustomer = null) {
  const isEdit = !!bookingId;
  const role   = appState.user.role;
  const uid    = appState.uid;
  const isSales = role === 'salesperson';

  // Show modal with loading state first
  const container = document.getElementById('modal-container');
  container.innerHTML = `
    <div class="modal-overlay" id="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal modal-xl">
        <div class="modal-header" style="display:flex;align-items:center;justify-content:space-between;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <h2 class="modal-title" id="modal-title" style="margin:0;">${isEdit ? 'Edit Schedule' : 'Create Schedule'}</h2>
            ${isEdit ? `
              <button id="modal-copy-id-btn" class="btn btn-secondary btn-sm" title="Click to copy Schedule ID (${escapeHtml(bookingId)})" style="padding:2px 8px;font-size:0.72rem;font-family:monospace;height:24px;display:inline-flex;align-items:center;gap:4px;background:var(--light-blue-50);color:var(--navy);border-color:var(--light-blue-100);cursor:pointer;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                ID: ${escapeHtml(bookingId.slice(0, 8))}…
              </button>
            ` : ''}
          </div>
          <button class="modal-close" id="modal-close-btn" aria-label="Close dialog">✕</button>
        </div>
        <div class="modal-body">${loadingHTML('Loading form…')}</div>
      </div>
    </div>`;

  const overlay = container.querySelector('#modal-overlay');
  const closeHandler = () => {
    overlay.classList.remove('modal-visible');
    setTimeout(() => { container.innerHTML = ''; }, 300);
  };
  document.getElementById('modal-close-btn').addEventListener('click', closeHandler);

  if (isEdit) {
    document.getElementById('modal-copy-id-btn')?.addEventListener('click', () => {
      navigator.clipboard.writeText(bookingId);
      showToast('Schedule ID copied to clipboard!', 'success');
    });
  }

  // Animate in
  requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('modal-visible')));

  // Load data
  let existingBooking = null;
  let allSalespersons = [];
  let allStaff        = [];

  try {
    if (!isSales) {
      const isSuper = role === 'super_admin';
      allSalespersons = await Users.getActiveSalespersons(isSuper);
      allStaff        = await Users.getActiveStaff(isSuper);
    }

    if (isEdit) {
      existingBooking = await Bookings.get(bookingId);
      if (!existingBooking) {
        container.querySelector('.modal-body').innerHTML = `
          <div style="text-align:center;padding:24px 16px;">
            <div style="font-size:2.2rem;margin-bottom:8px;">📋</div>
            <div style="font-weight:700;font-size:1.1rem;color:var(--text-primary);margin-bottom:4px;">Schedule Not Found</div>
            <div style="color:var(--text-secondary);font-size:0.85rem;">This schedule may have been deleted by Admin.</div>
          </div>`;
        return;
      }
      if (isSales && existingBooking.salespersonId !== uid && existingBooking.bookedById !== uid) {
        container.querySelector('.modal-body').innerHTML = errorHTML('You do not have permission to edit this schedule.');
        return;
      }
    } else if (prefillCustomer) {
      existingBooking = {
        snapshot_name: prefillCustomer.name || '',
        snapshot_contactNumber: prefillCustomer.contactNumber || '',
        snapshot_address: prefillCustomer.address || '',
        customerId: prefillCustomer.id || '',
      };
    }
  } catch (err) {
    console.error('Error loading schedule form data:', err);
    container.querySelector('.modal-body').innerHTML = errorHTML('Failed to load form data: ' + (err.message || err));
    return;
  }

  const b = existingBooking;
  const isSalesCreator = isSales && b && b.bookedById === uid;

  // Render the form inside the modal body
  const modalBody = container.querySelector('.modal-body');
  modalBody.innerHTML = `
    <div class="schedule-form-grid">

      <!-- Left Column -->
      <div style="display:flex;flex-direction:column;gap:16px;">

        <!-- Customer Info -->
        <div style="border:1px solid var(--divider);border-radius:var(--radius-md);padding:16px;">
          <div style="font-weight:600;font-size:0.85rem;color:var(--navy);margin-bottom:12px;">Customer Information</div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label required" for="bf-name">Customer Name</label>
              <input type="text" id="bf-name" class="form-control" placeholder="Full name"
                value="${escapeHtml(b?.snapshot_name || '')}"
                ${isSales && isEdit && !isSalesCreator ? 'disabled' : ''}>
            </div>
            <div class="form-group">
              <label class="form-label required" for="bf-phone">Contact Number</label>
              <div class="autocomplete-wrapper">
                <input type="tel" id="bf-phone" class="form-control" placeholder="+973 XXXX XXXX" autocomplete="off"
                  value="${escapeHtml(b?.snapshot_contactNumber || '')}"
                  ${isSales && isEdit && !isSalesCreator ? 'disabled' : ''}>
                <div class="autocomplete-dropdown hidden" id="phone-dropdown"></div>
              </div>
            </div>
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label" for="bf-address">Address</label>
            <input type="text" id="bf-address" class="form-control" placeholder="Street, Area, City"
              value="${escapeHtml(b?.snapshot_address || '')}"
              ${isSales && isEdit && !isSalesCreator ? 'disabled' : ''}>
          </div>
          <input type="hidden" id="bf-customer-id" value="${b?.customerId || ''}">
        </div>

        <!-- Service Details -->
        <div style="border:1px solid var(--divider);border-radius:var(--radius-md);padding:16px;">
          <div style="font-weight:600;font-size:0.85rem;color:var(--navy);margin-bottom:12px;">Service Details</div>
          
          <!-- First: Date and Time -->
          <div class="form-row">
            <div class="form-group" style="flex: 1;">
              <label class="form-label required" for="bf-date">Scheduled Date</label>
              <input type="date" id="bf-date" class="form-control"
                value="${b?.scheduledDate ? tsToDateInput(b.scheduledDate) : ''}"
                ${isSales && isEdit && !isSalesCreator ? 'disabled' : ''}>
            </div>
            <div class="form-group" style="flex: 1;">
              <label class="form-label required" for="bf-time">Scheduled Time</label>
              <div style="display: flex; gap: 8px;">
                <input type="text" id="bf-time" class="form-control" style="flex: 2;"
                  value="${b?.scheduledTime || (b?.scheduledDate ? formatTimePart(b.scheduledDate) : '')}"
                  placeholder="e.g. 10:00, Any"
                  ${isSales && isEdit && !isSalesCreator ? 'disabled' : ''}>
                <select id="bf-period" class="form-control" style="flex: 1;" ${isSales && isEdit && !isSalesCreator ? 'disabled' : ''}>
                  <option value="AM" ${getBookingPeriod(b) !== 'PM' ? 'selected' : ''}>AM</option>
                  <option value="PM" ${getBookingPeriod(b) === 'PM' ? 'selected' : ''}>PM</option>
                </select>
              </div>
            </div>
          </div>

          <!-- Below: Service Type -->
          <div class="form-group" style="margin-bottom:${b?.serviceType ? '12px' : '0'};">
            <label class="form-label required" for="bf-type">Service Type</label>
            <select id="bf-type" class="form-control" ${isSales && isEdit && !isSalesCreator ? 'disabled' : ''}>
              <option value="">Select type…</option>
              <option ${b?.serviceType==='Pickup'?'selected':''}>Pickup</option>
              <option ${b?.serviceType==='Delivery'?'selected':''}>Delivery</option>
              <option ${b?.serviceType==='Custom'?'selected':''}>Custom</option>
            </select>
          </div>

          <!-- Service Details / Description (Hidden until Service Type is selected) -->
          <div id="bf-details-group" class="form-group ${b?.serviceType ? '' : 'hidden'}" style="margin-bottom:0">
            <label class="form-label" for="bf-details">Service Details / Description</label>
            <textarea id="bf-details" class="form-control" rows="2"
              placeholder="Describe the service requirements…"
              ${isSales && isEdit && !isSalesCreator ? 'disabled' : ''}>${escapeHtml(b?.serviceDetails || '')}</textarea>
          </div>
        </div>
      </div>

      <!-- Right Column -->
      <div style="display:flex;flex-direction:column;gap:16px;">

        <!-- Assignment -->
        <div style="border:1px solid var(--divider);border-radius:var(--radius-md);padding:16px;">
          <div style="font-weight:600;font-size:0.85rem;color:var(--navy);margin-bottom:12px;">Assignment</div>
          <div class="form-group">
            <label class="form-label required" for="bf-salesperson">Salesperson</label>
            ${isSales ? `
              <input type="text" class="form-control form-control-readonly" value="${escapeHtml(appState.user.displayName)}" readonly>
              <input type="hidden" id="bf-salesperson" value="${uid}">
              <div class="form-hint">You are automatically assigned to schedules you create.</div>
            ` : `
            <select id="bf-salesperson" class="form-control">
              <option value="">Select salesperson…</option>
              ${allSalespersons.map(u => `<option value="${u.id}" ${b?.salespersonId===u.id?'selected':''}>${escapeHtml(u.displayName)}</option>`).join('')}
            </select>`}
          </div>

          <div class="form-group">
            ${role === 'office_staff' ? `
              <label class="form-label required" for="bf-booked-by">Created By</label>
              <input type="text" id="bf-booked-by" class="form-control"
                placeholder="Staff name / initials (e.g. Maria)"
                value="${escapeHtml(b ? (b.bookedByName || '') : '')}">
              <div class="form-hint">Enter your name or initials taking this booking.</div>
            ` : `
              <label class="form-label">Created By</label>
              <input type="text" class="form-control form-control-readonly"
                value="${escapeHtml(b?.bookedByName || appState.user.displayName || 'Admin')}" readonly>
            `}
            ${isEdit ? `
              <div class="form-group" style="margin-top:12px;margin-bottom:0">
                <label class="form-label required" for="bf-status">Status</label>
                <select id="bf-status" class="form-control">
                  <option value="Pending"   ${b?.status==='Pending'?'selected':''}>Pending</option>
                  <option value="Completed" ${b?.status==='Completed'?'selected':''}>Completed</option>
                  <option value="Others"    ${b?.status==='Others'?'selected':''}>Others</option>
                  <option value="Cancelled" ${b?.status==='Cancelled'?'selected':''}>Cancelled</option>
                </select>
              </div>
              <div id="bf-status-reason-group" class="form-group" style="margin-top:12px;margin-bottom:0;${b?.status === 'Others' ? '' : 'display:none;'}">
                <label class="form-label required" for="bf-status-reason">Reason for "Others"</label>
                <input type="text" id="bf-status-reason" class="form-control"
                  placeholder="e.g. Customer not answering call, rescheduled…"
                  value="${escapeHtml(b?.statusReason || '')}">
              </div>` : ''}
          </div>
        </div>

        <!-- Completion Notes (Edit mode only) -->
        ${isEdit ? `
        <div style="border:1px solid var(--divider);border-radius:var(--radius-md);padding:16px;">
          <div style="font-weight:600;font-size:0.85rem;color:var(--navy);margin-bottom:12px;">Completion Notes</div>
          <div class="form-group" style="margin-bottom:0">
            <textarea id="bf-completion" class="form-control" rows="3"
              placeholder="Notes after job completion…">${escapeHtml(b?.completionNotes || '')}</textarea>
          </div>
        </div>` : ''}

        <!-- Info note -->
        <div style="background:var(--light-blue-50);border:1px solid var(--light-blue-100);border-radius:var(--radius-md);padding:12px 14px;">
          <div class="text-sm" style="color:var(--blue);">
            <strong>Note:</strong> Customer information entered here will be preserved permanently with this schedule.
            Changes to the customer record later will not affect this schedule.
          </div>
        </div>

        <!-- Action buttons -->
        <div style="display:flex;flex-direction:column;gap:8px;">
          <button class="btn btn-primary btn-lg w-full" id="save-btn">
            ${isEdit ? 'Save Changes' : 'Create Schedule'}
          </button>

          ${isEdit && (!isSales || isSalesCreator) ? `
          <button class="btn btn-danger w-full" id="cancel-schedule-btn">
            Cancel Schedule
          </button>` : ''}
        </div>

        <div id="form-err" class="alert alert-danger hidden"></div>
      </div>
    </div>`;

  // ── Customer Autocomplete ──────────────────────────
  if (!isSales || !isEdit || isSalesCreator) {
    const dropdown      = document.getElementById('phone-dropdown');
    const nameInput     = document.getElementById('bf-name');
    const phoneInput    = document.getElementById('bf-phone');
    const addressInput  = document.getElementById('bf-address');
    const customerIdEl  = document.getElementById('bf-customer-id');

    const doSearch = debounce(async (val) => {
      if (val.length < 2) { dropdown.classList.add('hidden'); return; }
      try {
        const results = await Customers.searchByPhone(val);
        // Guard against out-of-order responses
        if (phoneInput.value.trim() !== val) return;
        if (!results.length) {
          dropdown.innerHTML = `<div class="autocomplete-empty">No customers found for "${escapeHtml(val)}"</div>`;
        } else {
          dropdown.innerHTML = results.map(c => `
            <div class="autocomplete-item" data-id="${c.id}" data-name="${escapeHtml(c.name)}"
              data-phone="${escapeHtml(c.contactNumber)}" data-address="${escapeHtml(c.address||'')}">
              <div class="autocomplete-item-name">${escapeHtml(c.name)}</div>
              <div class="autocomplete-item-sub">${escapeHtml(c.contactNumber)}${c.address ? ' · '+escapeHtml(c.address.slice(0,40)) : ''}</div>
            </div>`).join('');
        }
        dropdown.classList.remove('hidden');
      } catch(_) {}
    }, 300);

    phoneInput.addEventListener('input', e => doSearch(e.target.value.trim()));

    dropdown.addEventListener('click', e => {
      const item = e.target.closest('.autocomplete-item');
      if (!item) return;
      nameInput.value    = item.dataset.name;
      phoneInput.value   = item.dataset.phone;
      addressInput.value = item.dataset.address;
      customerIdEl.value = item.dataset.id;
      dropdown.classList.add('hidden');
    });

    // Close dropdown when clicking outside within the modal
    modalBody.addEventListener('click', e => {
      if (!e.target.closest('.autocomplete-wrapper')) dropdown.classList.add('hidden');
    });
  }

  // ── Toggle Service Details Visibility on Type Change ──
  const typeSelectEl = document.getElementById('bf-type');
  const detailsGroupEl = document.getElementById('bf-details-group');
  if (typeSelectEl && detailsGroupEl) {
    typeSelectEl.addEventListener('change', () => {
      if (typeSelectEl.value) {
        detailsGroupEl.classList.remove('hidden');
        typeSelectEl.parentElement.style.marginBottom = '12px';
      } else {
        detailsGroupEl.classList.add('hidden');
        typeSelectEl.parentElement.style.marginBottom = '0';
      }
    });
  }

  // ── Toggle Reason for Others Field on Status Change ──
  const statusSelectEl = document.getElementById('bf-status');
  const statusReasonGroupEl = document.getElementById('bf-status-reason-group');
  if (statusSelectEl && statusReasonGroupEl) {
    statusSelectEl.addEventListener('change', () => {
      const isOthers = statusSelectEl.value === 'Others';
      statusReasonGroupEl.style.display = isOthers ? 'block' : 'none';
      if (isOthers) {
        document.getElementById('bf-status-reason')?.focus();
      }
    });
  }

  // ── Save ──────────────────────────────────────────
  document.getElementById('save-btn').addEventListener('click', async () => {
    const canEditAll = !isSales || !isEdit || isSalesCreator;
    const errEl    = document.getElementById('form-err');
    const name     = document.getElementById('bf-name').value.trim();
    const phone    = document.getElementById('bf-phone').value.trim();
    const address  = document.getElementById('bf-address').value.trim();
    const custId   = document.getElementById('bf-customer-id').value;
    const typeVal  = canEditAll ? document.getElementById('bf-type')?.value : (b?.serviceType || '');
    const dateVal  = canEditAll ? document.getElementById('bf-date')?.value : null;
    const timeVal  = canEditAll ? (document.getElementById('bf-time')?.value.trim() || '') : (b?.scheduledTime || '');
    const periodVal = canEditAll ? document.getElementById('bf-period')?.value : (b?.scheduledPeriod || 'AM');
    const details  = document.getElementById('bf-details').value.trim();
    const notes    = b?.notes || '';
    const salesId  = document.getElementById('bf-salesperson').value;
    const isOfficeStaff = role === 'office_staff';
    const bookedByName = isOfficeStaff
      ? (document.getElementById('bf-booked-by')?.value.trim() || '')
      : (b?.bookedByName || appState.user.displayName || 'Admin');
    const statusVal = isEdit ? document.getElementById('bf-status').value : 'Pending';
    const statusReason = (document.getElementById('bf-status-reason')?.value || '').trim();
    const completion = isEdit ? document.getElementById('bf-completion')?.value.trim() || '' : '';

    // Validation
    const errors = [];
    if (!name)    errors.push('Customer name is required.');
    if (!phone)   errors.push('Contact number is required.');
    if (!typeVal) errors.push('Service type is required.');
    if (!salesId) errors.push('Salesperson is required.');
    if (canEditAll && !dateVal) errors.push('Scheduled date is required.');
    if (canEditAll && !timeVal) errors.push('Scheduled time is required (e.g. 10:00, Any).');
    if (isOfficeStaff && !bookedByName) errors.push('Created By (Staff Name) is required.');
    if (statusVal === 'Others' && !statusReason) errors.push('Reason for "Others" status is required.');
    if (errors.length) {
      errEl.innerHTML = errors.map(e => `<div>• ${escapeHtml(e)}</div>`).join('');
      errEl.classList.remove('hidden');
      errEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    errEl.classList.add('hidden');

    const saveBtn = document.getElementById('save-btn');
    const restore = btnLoading(saveBtn, 'Saving…');

    try {
      // Find or create customer if not linked
      let finalCustomerId = custId;
      if (canEditAll && !finalCustomerId && phone) {
        const existingCusts = await Customers.searchByPhone(phone);
        if (existingCusts.length > 0) {
          const cleanSearch = phone.replace(/\D/g, '');
          const match = existingCusts.find(c => c.contactNumber.replace(/\D/g, '') === cleanSearch);
          if (match) {
            finalCustomerId = match.id;
          }
        }
        if (!finalCustomerId) {
          const newCust = await Customers.create({
            name,
            contactNumber: phone,
            address: address || ''
          });
          finalCustomerId = newCust.id;
        }
      }

      // Find salesperson name
      let salesName = appState.user.displayName;
      if (!isSales) {
        const salesEl = document.getElementById('bf-salesperson');
        salesName = salesEl.options[salesEl.selectedIndex]?.text || '';
      }

      const scheduledDate = (isEdit && !canEditAll) ? b.scheduledDate : inputToTimestamp(dateVal);

      if (isEdit) {
        const prevSalesId = b.salespersonId;
        let updates;
        if (isSales && !isSalesCreator) {
          updates = {
            status:          statusVal,
            statusReason:    statusVal === 'Others' ? statusReason : '',
            completionNotes: completion,
          };
        } else {
          updates = {
            snapshot_name:          name,
            snapshot_contactNumber: phone,
            snapshot_address:       address,
            customerId:             finalCustomerId || null,
            serviceDetails:         details,
            notes,
            completionNotes:        completion,
            status:                 statusVal,
            statusReason:           statusVal === 'Others' ? statusReason : '',
            serviceType:            typeVal,
            scheduledDate:          scheduledDate,
            scheduledTime:          timeVal,
            scheduledPeriod:        periodVal,
            salespersonId:          salesId,
            salespersonName:        salesName,
            bookedByName:           bookedByName || b?.bookedByName || appState.user.displayName,
          };
        }

        await Bookings.update(bookingId, updates);

        // Activity log
        await ActivityLog.write({
          bookingId,
          action: 'BOOKING_UPDATED',
          details: { status: statusVal, ...(statusVal === 'Others' && statusReason ? { reason: statusReason } : {}), salesperson: salesName }
        });

        // Notify on reassignment
        if (!isSales && salesId !== prevSalesId) {
          await ActivityLog.write({ bookingId, action: 'SALESPERSON_REASSIGNED',
            details: { from: b.salespersonName, to: salesName } });
          await Notifications.create({
            recipientId: salesId,
            type: 'assignment',
            bookingId,
            message: `You have been assigned to a schedule for ${name} (${phone}) scheduled on ${formatDate(scheduledDate)} (${timeVal} ${periodVal}).`
          });
        }

        showToast('Schedule updated successfully.', 'success');
      } else {
        const newBooking = await Bookings.create({
          serviceType:            typeVal,
          serviceDetails:         details,
          customerId:             finalCustomerId || null,
          snapshot_name:          name,
          snapshot_contactNumber: phone,
          snapshot_address:       address,
          scheduledDate:          scheduledDate,
          scheduledTime:          timeVal,
          scheduledPeriod:        periodVal,
          salespersonId:          salesId,
          salespersonName:        salesName,
          notes,
          bookedByName:           bookedByName,
        });

        // Activity log
        await ActivityLog.write({
          bookingId: newBooking.id,
          action: 'BOOKING_CREATED',
          details: { customer: name, serviceType: typeVal, salesperson: salesName, bookedBy: bookedByName }
        });

        // Notification to salesperson
        await Notifications.create({
          recipientId: salesId,
          type: 'assignment',
          bookingId: newBooking.id,
          message: `New schedule assigned: ${name} (${phone}) — ${typeVal} service on ${formatDate(scheduledDate)} (${timeVal} ${periodVal}).`
        });

        showToast('Schedule created successfully.', 'success');
      }

      // Close modal and refresh
      closeHandler();
      if (onSaved) onSaved();
    } catch (err) {
      console.error(err);
      errEl.textContent = 'Failed to save schedule: ' + (err.message || 'Unknown error');
      errEl.classList.remove('hidden');
      restore();
    }
  });

  // ── Cancel schedule (set status Cancelled) ────────
  const cancelScheduleBtn = document.getElementById('cancel-schedule-btn');
  if (cancelScheduleBtn) {
    cancelScheduleBtn.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to cancel this schedule? This cannot be undone by the salesperson.')) return;
      try {
        await Bookings.update(bookingId, { status: 'Cancelled' });
        await ActivityLog.write({ bookingId, action: 'BOOKING_CANCELLED', details: {} });
        showToast('Schedule cancelled.', 'success');
        closeHandler();
        if (onSaved) onSaved();
      } catch (err) {
        showToast('Failed to cancel schedule.', 'error');
      }
    });
  }
}

/**
 * Legacy page render — redirects to modal or used for edit via route.
 */
export async function renderBookingForm(container, appState, bookingId = null) {
  if (bookingId) {
    // Edit mode: open modal and navigate back after
    container.innerHTML = loadingHTML('Opening editor…');
    openScheduleModal(appState, bookingId, () => {
      window._navigate && window._navigate('/schedules');
    });
  } else {
    // New schedule: open modal and navigate back
    container.innerHTML = '';
    openScheduleModal(appState, null, () => {
      window._navigate && window._navigate('/schedules');
    });
  }
}
