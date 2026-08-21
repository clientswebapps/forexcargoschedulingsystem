/**
 * booking-detail.js — Schedule Detail view (read-only with quick actions)
 */
'use strict';
import { Bookings, ActivityLog } from '../db.js';
import { formatDateTime, formatBookingDateTime, statusBadge, serviceBadge, timeAgo, loadingHTML, errorHTML, escapeHtml, showToast } from '../utils.js';
import { openScheduleModal } from './booking-form.js';

export async function renderBookingDetail(container, appState, bookingId) {
  if (!bookingId) { container.innerHTML = errorHTML('No schedule ID provided.'); return; }

  container.innerHTML = loadingHTML('Loading schedule…');
  const role  = appState.user.role;
  const uid   = appState.uid;

  let b = null;
  let logs = [];
  let unsub = null;

  try {
    logs = await ActivityLog.getForBooking(bookingId);

    unsub = Bookings.onSnapshot(bookingId, (doc) => {
      if (!doc) {
        container.innerHTML = errorHTML('Schedule not found.');
        return;
      }

      // Salesperson can only view their own (assigned or self-created)
      if (role === 'salesperson' && doc.salespersonId !== uid && doc.bookedById !== uid) {
        container.innerHTML = errorHTML('You do not have permission to view this schedule.');
        return;
      }

      b = doc;
      renderDetail();
    });

    const isSales = role === 'salesperson';

    function renderDetail() {
      if (!b) return;
      const canEdit = role !== 'salesperson' || b.salespersonId === uid || b.bookedById === uid;
      container.innerHTML = `
        <div class="page-header">
          <div class="page-header-left">
            <div class="breadcrumb">
              <div class="breadcrumb-item"><a href="#" onclick="event.preventDefault();window._navigate('${isSales?'/my-schedule':'/schedules'}')">
                ${isSales ? 'My Schedule' : 'Schedules'}</a></div>
              <div class="breadcrumb-sep">›</div>
              <div class="breadcrumb-item active">Schedule Detail</div>
            </div>
            <h1 class="page-title">${escapeHtml(b.snapshot_name)}</h1>
            <div class="page-subtitle">${serviceBadge(b.serviceType)} &nbsp; ${statusBadge(b.status)}</div>
          </div>
          <div class="page-actions">
            ${canEdit ? `<button class="btn btn-primary" id="edit-schedule-btn">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Edit Schedule
            </button>` : ''}
          </div>
        </div>

        <div style="display:grid;grid-template-columns:2fr 1fr;gap:20px;align-items:start;">

          <div style="display:flex;flex-direction:column;gap:20px;">

            <!-- Customer Info -->
            <div class="card">
              <div class="card-header"><div class="card-title">Customer Information</div><div class="text-xs text-secondary">Snapshot at time of creation</div></div>
              <div class="card-body">
                <div class="detail-grid">
                  <div class="detail-item">
                    <div class="detail-label">Name</div>
                    <div class="detail-value large">${escapeHtml(b.snapshot_name || '—')}</div>
                  </div>
                  <div class="detail-item">
                    <div class="detail-label">Contact Number</div>
                    <div class="detail-value large">${escapeHtml(b.snapshot_contactNumber || '—')}</div>
                  </div>
                  <div class="detail-item" style="grid-column:1/-1">
                    <div class="detail-label">Address</div>
                    <div class="detail-value">${escapeHtml(b.snapshot_address || '—')}</div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Service Details -->
            <div class="card">
              <div class="card-header"><div class="card-title">Service Details</div></div>
              <div class="card-body">
                <div class="detail-grid">
                  <div class="detail-item">
                    <div class="detail-label">Service Type</div>
                    <div class="detail-value">${serviceBadge(b.serviceType)}</div>
                  </div>
                  <div class="detail-item">
                    <div class="detail-label">Scheduled Date &amp; Time</div>
                    <div class="detail-value large">${formatBookingDateTime(b)}</div>
                  </div>
                  <div class="detail-item" style="grid-column:1/-1">
                    <div class="detail-label">Service Details</div>
                    <div class="detail-value">${escapeHtml(b.serviceDetails || '—')}</div>
                  </div>
                  <div class="detail-item" style="grid-column:1/-1">
                    <div class="detail-label">Notes &amp; Preferences</div>
                    <div class="detail-value">${escapeHtml(b.notes || '—')}</div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Completion Notes -->
            ${b.completionNotes || isSales ? `
            <div class="card">
              <div class="card-header">
                <div class="card-title">Completion Notes</div>
              </div>
              <div class="card-body">
                ${isSales && b.status === 'Pending' ? `
                  <div class="form-group">
                    <textarea id="completion-notes-input" class="form-control" rows="4"
                      placeholder="Enter completion notes here…">${escapeHtml(b.completionNotes || '')}</textarea>
                  </div>
                  <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;">
                    <button class="btn btn-secondary" id="save-notes-btn">Save Notes</button>
                    <button class="btn btn-primary" id="mark-complete-btn">Mark Completed</button>
                  </div>
                ` : `
                  <div class="detail-value">${escapeHtml(b.completionNotes || '—')}</div>
                `}
              </div>
            </div>` : ''}

          </div>

          <!-- Right Column -->
          <div style="display:flex;flex-direction:column;gap:20px;">

            <!-- Assignment -->
            <div class="card">
              <div class="card-header"><div class="card-title">Assignment</div></div>
              <div class="card-body">
                <div class="detail-item" style="margin-bottom:14px;">
                  <div class="detail-label">Status</div>
                  <div class="detail-value" style="margin-top:4px;">${statusBadge(b.status)}</div>
                </div>
                <div class="detail-item" style="margin-bottom:14px;">
                  <div class="detail-label">Assigned Salesperson</div>
                  <div class="detail-value large">${escapeHtml(b.salespersonName || '—')}</div>
                </div>
                <div class="detail-item" style="margin-bottom:14px;">
                  <div class="detail-label">Created By</div>
                  <div class="detail-value">${escapeHtml(b.bookedByName || '—')}</div>
                </div>
                <div class="divider"></div>
                <div class="detail-item" style="margin-bottom:6px;">
                  <div class="detail-label">Created</div>
                  <div class="detail-value text-sm">${formatDateTime(b.createdAt)}</div>
                </div>
                <div class="detail-item">
                  <div class="detail-label">Last Updated</div>
                  <div class="detail-value text-sm">${formatDateTime(b.updatedAt)}</div>
                </div>
              </div>
            </div>

            <!-- Activity Log -->
            ${!isSales ? `
            <div class="card">
              <div class="card-header"><div class="card-title">Activity History</div></div>
              <div class="card-body" style="padding:0;">
                ${logs.length === 0 ? `<div class="table-empty" style="padding:24px;">No activity yet.</div>` : `
                <div class="activity-list" style="padding:0 16px;">
                  ${logs.map((log, i) => `
                    <div class="activity-item">
                      <div class="activity-dot-wrap">
                        <div class="activity-dot"></div>
                        ${i < logs.length-1 ? '<div class="activity-line"></div>' : ''}
                      </div>
                      <div class="activity-content">
                        <div class="activity-action">${formatAction(log.action)}</div>
                        <div class="activity-meta">${escapeHtml(log.actorName || '—')} · ${timeAgo(log.timestamp)}</div>
                        ${log.details && Object.keys(log.details).length ? `
                          <div class="activity-details">${formatDetails(log.details)}</div>` : ''}
                      </div>
                    </div>`).join('')}
                </div>`}
              </div>
            </div>` : ''}

          </div>
        </div>`;

      // Edit button opens modal
      const editBtn = document.getElementById('edit-schedule-btn');
      if (editBtn) {
        editBtn.addEventListener('click', () => {
          openScheduleModal(appState, bookingId);
        });
      }

      // Salesperson completion actions
      if (isSales && b.status === 'Pending') {
        document.getElementById('save-notes-btn')?.addEventListener('click', async () => {
          const notes = document.getElementById('completion-notes-input').value.trim();
          await Bookings.updateSalesperson(b.id, { completionNotes: notes, status: 'Pending' });
          showToast('Notes saved.', 'success');
        });

        document.getElementById('mark-complete-btn')?.addEventListener('click', async () => {
          if (!confirm('Mark this schedule as Completed?')) return;
          const notes = document.getElementById('completion-notes-input').value.trim();
          await Bookings.updateSalesperson(b.id, { completionNotes: notes, status: 'Completed' });
          await ActivityLog.write({ bookingId: b.id, action: 'STATUS_CHANGED', details: { from: 'Pending', to: 'Completed' } });
          showToast('Schedule marked as completed.', 'success');
          window._navigate && window._navigate('/my-schedule');
        });
      }
    }

  } catch (err) {
    console.error(err);
    container.innerHTML = errorHTML('Failed to load schedule details.');
  }

  return () => {
    if (unsub) {
      unsub();
      unsub = null;
    }
  };
}

function formatAction(action) {
  const map = {
    BOOKING_CREATED:       '📋 Schedule Created',
    BOOKING_UPDATED:       '✏️ Schedule Updated',
    BOOKING_CANCELLED:     '🚫 Schedule Cancelled',
    STATUS_CHANGED:        '🔄 Status Changed',
    SALESPERSON_REASSIGNED:'👤 Salesperson Reassigned',
  };
  return map[action] || action;
}

function formatDetails(details) {
  return Object.entries(details)
    .map(([k, v]) => `<span style="font-weight:500">${escapeHtml(k)}:</span> ${escapeHtml(String(v))}`)
    .join(' &nbsp;·&nbsp; ');
}
