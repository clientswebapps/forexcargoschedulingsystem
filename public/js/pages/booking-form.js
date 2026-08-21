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
export async function openScheduleModal(appState, bookingId = null, onSaved = null) {
  const isEdit = !!bookingId;
  const role   = appState.user.role;
  const uid    = appState.uid;
  const isSales = role === 'salesperson';

  // Show modal with loading state first
  const container = document.getElementById('modal-container');
  container.innerHTML = `
    <div class="modal-overlay" id="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal modal-xl">
        <div class="modal-header">
          <h2 class="modal-title" id="modal-title">${isEdit ? 'Edit Schedule' : 'Create Schedule'}</h2>
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

  // Animate in
  requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('modal-visible')));

  // Load data
  let existingBooking = null;
  let allSalespersons = [];
  let allStaff        = [];

  try {
    if (!isSales) {
      allSalespersons = await Users.getActiveSalespersons();
      allStaff        = await Users.getActiveStaff();
    }

    if (isEdit) {
      existingBooking = await Bookings.get(bookingId);
      if (!existingBooking) {
        container.querySelector('.modal-body').innerHTML = errorHTML('Schedule not found.');
        return;
      }
      if (isSales && existingBooking.salespersonId !== uid && existingBooking.bookedById !== uid) {
        container.querySelector('.modal-body').innerHTML = errorHTML('You do not have permission to edit this schedule.');
        return;
      }
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
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start;">

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
          <div class="form-row">
            <div class="form-group">
              <label class="form-label required" for="bf-type">Service Type</label>
              <select id="bf-type" class="form-control" ${isSales && isEdit && !isSalesCreator ? 'disabled' : ''}>
                <option value="">Select type…</option>
                <option ${b?.serviceType==='Pickup'?'selected':''}>Pickup</option>
                <option ${b?.serviceType==='Delivery'?'selected':''}>Delivery</option>
                <option ${b?.serviceType==='Custom'?'selected':''}>Custom</option>
              </select>
            </div>
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
          <div class="form-group" style="margin-bottom:0">
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
            <label class="form-label">Created By</label>
            <input type="text" class="form-control form-control-readonly"
              value="${escapeHtml(b?.bookedByName || appState.user.displayName)}" readonly>
          </div>

          ${isEdit ? `
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label required" for="bf-status">Status</label>
            <select id="bf-status" class="form-control">
              ${isSales && !isSalesCreator ? `
                <option value="Pending"   ${b?.status==='Pending'?'selected':''}>Pending</option>
                <option value="Completed" ${b?.status==='Completed'?'selected':''}>Completed</option>
              ` : `
                <option value="Pending"   ${b?.status==='Pending'?'selected':''}>Pending</option>
                <option value="Completed" ${b?.status==='Completed'?'selected':''}>Completed</option>
                <option value="Cancelled" ${b?.status==='Cancelled'?'selected':''}>Cancelled</option>
              `}
            </select>
          </div>` : ''}
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

  // ── Save ──────────────────────────────────────────
  document.getElementById('save-btn').addEventListener('click', async () => {
    const errEl    = document.getElementById('form-err');
    const name     = document.getElementById('bf-name').value.trim();
    const phone    = document.getElementById('bf-phone').value.trim();
    const address  = document.getElementById('bf-address').value.trim();
    const custId   = document.getElementById('bf-customer-id').value;
    const typeVal  = !isSales || !isEdit ? document.getElementById('bf-type').value : b.serviceType;
    const dateVal  = !isSales || !isEdit ? document.getElementById('bf-date').value : null;
    const timeVal  = !isSales || !isEdit ? document.getElementById('bf-time').value.trim() : '';
    const periodVal = !isSales || !isEdit ? document.getElementById('bf-period').value : 'Anytime';
    const details  = document.getElementById('bf-details').value.trim();
    const notes    = b?.notes || '';
    const salesId  = document.getElementById('bf-salesperson').value;
    const statusVal = isEdit ? document.getElementById('bf-status').value : 'Pending';
    const completion = isEdit ? document.getElementById('bf-completion')?.value.trim() || '' : '';

    // Validation
    const errors = [];
    if (!name)    errors.push('Customer name is required.');
    if (!phone)   errors.push('Contact number is required.');
    if (!typeVal) errors.push('Service type is required.');
    if (!salesId) errors.push('Salesperson is required.');
    if (!isEdit && !dateVal) errors.push('Scheduled date is required.');
    if (!isEdit && !timeVal) errors.push('Scheduled time is required (e.g. 10:00, Any).');
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
      if ((!isSales || !isEdit || isSalesCreator) && !finalCustomerId && phone) {
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

      const scheduledDate = isEdit && isSales ? b.scheduledDate : inputToTimestamp(dateVal);

      if (isEdit) {
        const prevSalesId = b.salespersonId;
        let updates;
        if (isSales && !isSalesCreator) {
          updates = {
            status:          statusVal,
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
            serviceType:            typeVal,
            scheduledDate:          scheduledDate,
            scheduledTime:          timeVal,
            scheduledPeriod:        periodVal,
            salespersonId:          salesId,
            salespersonName:        salesName,
          };
        }

        await Bookings.update(bookingId, updates);

        // Activity log
        await ActivityLog.write({
          bookingId,
          action: 'BOOKING_UPDATED',
          details: { status: statusVal, salesperson: salesName }
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
          bookedByName:           appState.user.displayName,
        });

        // Activity log
        await ActivityLog.write({
          bookingId: newBooking.id,
          action: 'BOOKING_CREATED',
          details: { customer: name, serviceType: typeVal, salesperson: salesName }
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
