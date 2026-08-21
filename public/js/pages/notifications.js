/**
 * notifications.js — In-system notifications page
 */
'use strict';
import { Notifications } from '../db.js';
import { showToast, loadingHTML, errorHTML, escapeHtml, timeAgo } from '../utils.js';

export async function renderNotifications(container, appState) {
  const uid = appState.uid;

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Notifications</h1>
        <div class="page-subtitle">Schedule assignments and updates</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-secondary btn-sm" id="mark-all-read-btn">Mark All Read</button>
      </div>
    </div>
    <div class="card">
      <div id="notif-list">${loadingHTML()}</div>
    </div>`;

  let notifs = [];
  let unsubscribe = null;

  function load() {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    const el = document.getElementById('notif-list');
    if (el && !notifs.length) {
      el.innerHTML = loadingHTML();
    }
    try {
      unsubscribe = Notifications.onSnapshot(uid, (list) => {
        notifs = list;
        render();
      });
    } catch (err) {
      if (el) el.innerHTML = errorHTML('Failed to load notifications.');
    }
  }

  function render() {
    const el = document.getElementById('notif-list');
    if (!el) return;
    if (!notifs.length) {
      el.innerHTML = `<div class="table-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        No notifications yet.</div>`;
      return;
    }

    el.innerHTML = notifs.map(n => `
      <div class="notif-item ${n.read ? '' : 'unread'}" data-id="${n.id}">
        <div class="notif-icon">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            ${n.type === 'assignment'
              ? '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'
              : '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>'}
          </svg>
        </div>
        <div class="notif-content">
          <div class="notif-message">${escapeHtml(n.message)}</div>
          <div class="notif-time">${timeAgo(n.createdAt)}</div>
          ${n.bookingId ? `
            <div style="margin-top:6px;">
              <a href="#" onclick="event.preventDefault();window._navigate('/schedules/view/${n.bookingId}')" class="text-sm text-blue">
                View Schedule →
              </a>
            </div>` : ''}
        </div>
        ${!n.read ? `<div class="notif-dot"></div>` : ''}
      </div>`).join('');

    // Mark individual notification as read on click
    el.querySelectorAll('.notif-item').forEach(item => {
      item.addEventListener('click', async () => {
        const id = item.dataset.id;
        const notif = notifs.find(n => n.id === id);
        if (notif && !notif.read) {
          await Notifications.markRead(id);
          notif.read = true;
          item.classList.remove('unread');
          item.querySelector('.notif-dot')?.remove();
          // Update badge count in topbar
          window._refreshNotifBadge && window._refreshNotifBadge();
        }
      });
    });
  }

  document.getElementById('mark-all-read-btn')?.addEventListener('click', async () => {
    try {
      await Notifications.markAllRead(uid);
      notifs.forEach(n => n.read = true);
      render();
      window._refreshNotifBadge && window._refreshNotifBadge();
      showToast('All notifications marked as read.', 'success');
    } catch (err) {
      showToast('Failed to mark notifications as read.', 'error');
    }
  });

  load();

  return () => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };
}
