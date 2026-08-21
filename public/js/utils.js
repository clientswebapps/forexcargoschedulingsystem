/**
 * utils.js — Shared utility functions
 * Forex Cargo Scheduling System
 */

'use strict';

/* ── Date / Time ─────────────────────────────────────────── */

export function formatDate(ts) {
  if (!ts) return '—';
  const d = ts && ts.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(ts) {
  if (!ts) return '—';
  const d = ts && ts.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true
  });
}

/** Returns value for datetime-local <input> */
export function tsToInputValue(ts) {
  if (!ts) return '';
  const d = ts && ts.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d)) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Returns value for date <input> */
export function tsToDateInput(ts) {
  if (!ts) return '';
  const d = ts && ts.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d)) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

/** Format time part of a Timestamp into a string (e.g. 10:00 AM) */
export function formatTimePart(ts) {
  if (!ts) return '';
  const d = ts && ts.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d)) return '';
  let hr = d.getHours();
  const min = String(d.getMinutes()).padStart(2, '0');
  const ampm = hr >= 12 ? 'PM' : 'AM';
  hr = hr % 12;
  hr = hr ? hr : 12;
  return `${hr}:${min} ${ampm}`;
}

/** Returns the AM/PM/Anytime period of a booking, with a fallback for legacy records */
export function getBookingPeriod(b) {
  if (!b) return 'Anytime';
  if (b.scheduledPeriod) return b.scheduledPeriod;
  if (!b.scheduledDate) return 'Anytime';
  const d = b.scheduledDate.toDate ? b.scheduledDate.toDate() : new Date(b.scheduledDate);
  if (isNaN(d)) return 'Anytime';
  if (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0) return 'Anytime';
  return d.getHours() >= 12 ? 'PM' : 'AM';
}

/** Formats a booking's time and period string cleanly (e.g. "10:00 AM" or "Anytime") */
export function formatBookingTime(b) {
  if (!b) return '—';
  if (b.scheduledTime) {
    const period = b.scheduledPeriod && b.scheduledPeriod !== 'Anytime' ? ` ${b.scheduledPeriod}` : '';
    return `${b.scheduledTime}${period}`;
  }
  const d = b.scheduledDate && b.scheduledDate.toDate ? b.scheduledDate.toDate() : new Date(b.scheduledDate);
  if (isNaN(d)) return '—';
  if (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0) return 'Anytime';
  return formatTimePart(b.scheduledDate);
}

/** Formats a booking's date and custom time string cleanly, supporting legacy timestamp-only records */
export function formatBookingDateTime(b) {
  if (!b) return '—';
  const dateStr = formatDate(b.scheduledDate);
  const timeStr = formatBookingTime(b);
  if (timeStr === 'Anytime' || !timeStr || timeStr === '—') return dateStr;
  return `${dateStr}, ${timeStr}`;
}

/** Convert date or datetime-local string → Firestore Timestamp */
export function inputToTimestamp(str) {
  if (!str) return null;
  if (!str.includes('T')) {
    const [y, m, d] = str.split('-').map(Number);
    return firebase.firestore.Timestamp.fromDate(new Date(y, m - 1, d, 0, 0, 0));
  }
  return firebase.firestore.Timestamp.fromDate(new Date(str));
}

export function timeAgo(ts) {
  if (!ts) return '';
  const d = ts && ts.toDate ? ts.toDate() : new Date(ts);
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return formatDate(ts);
}

/** Today at midnight as a Firestore Timestamp */
export function todayStart() {
  const d = new Date(); d.setHours(0,0,0,0);
  return firebase.firestore.Timestamp.fromDate(d);
}

/** Tomorrow at midnight as a Firestore Timestamp */
export function tomorrowStart() {
  const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()+1);
  return firebase.firestore.Timestamp.fromDate(d);
}

/** Calculate date range strings (YYYY-MM-DD) for filter presets */
export function getDateRange(rangeType, customFrom = '', customTo = '') {
  const now = new Date();
  const formatYMD = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  if (rangeType === 'today') {
    const todayStr = formatYMD(now);
    return { dateFrom: todayStr, dateTo: todayStr };
  }
  if (rangeType === 'week') {
    const current = new Date(now);
    const day = current.getDay(); // 0 is Sunday
    const sunday = new Date(current);
    sunday.setDate(current.getDate() - day);
    const saturday = new Date(sunday);
    saturday.setDate(sunday.getDate() + 6);
    return { dateFrom: formatYMD(sunday), dateTo: formatYMD(saturday) };
  }
  if (rangeType === 'month') {
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { dateFrom: formatYMD(firstDay), dateTo: formatYMD(lastDay) };
  }
  if (rangeType === 'all') {
    return { dateFrom: '', dateTo: '' };
  }
  if (rangeType === 'custom') {
    return { dateFrom: customFrom || '', dateTo: customTo || '' };
  }
  const todayStr = formatYMD(now);
  return { dateFrom: todayStr, dateTo: todayStr };
}

/* ── Toasts ──────────────────────────────────────────────── */

export function showToast(message, type = 'info', duration = 3800) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', 'alert');
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-message">${escapeHtml(message)}</span>
    <button class="toast-close" aria-label="Dismiss">✕</button>
  `;
  container.appendChild(toast);
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('toast-visible')));
  const remove = () => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 350);
  };
  toast.querySelector('.toast-close').addEventListener('click', remove);
  const t = setTimeout(remove, duration);
  toast.querySelector('.toast-close').addEventListener('click', () => clearTimeout(t));
}

/* ── Modal ───────────────────────────────────────────────── */

export function showModal({ title, body, confirmText = 'Confirm', cancelText = 'Cancel', onConfirm, danger = false, wide = false }) {
  closeModal();
  const container = document.getElementById('modal-container');
  container.innerHTML = `
    <div class="modal-overlay" id="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal${wide ? ' modal-lg' : ''}">
        <div class="modal-header">
          <h2 class="modal-title" id="modal-title">${escapeHtml(title)}</h2>
          <button class="modal-close" id="modal-close-btn" aria-label="Close dialog">✕</button>
        </div>
        <div class="modal-body">${body}</div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="modal-cancel-btn">${escapeHtml(cancelText)}</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="modal-confirm-btn">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    </div>`;
  const overlay = container.querySelector('#modal-overlay');
  const close = () => closeModal();
  document.getElementById('modal-close-btn').addEventListener('click', close);
  document.getElementById('modal-cancel-btn').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  if (onConfirm) {
    document.getElementById('modal-confirm-btn').addEventListener('click', async () => {
      const btn = document.getElementById('modal-confirm-btn');
      btn.disabled = true;
      try { await onConfirm(); close(); } catch (err) { btn.disabled = false; }
    });
  }
  requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('modal-visible')));
}

export function closeModal() {
  const container = document.getElementById('modal-container');
  const overlay = container && container.querySelector('.modal-overlay');
  if (overlay) {
    overlay.classList.remove('modal-visible');
    setTimeout(() => { if (container) container.innerHTML = ''; }, 300);
  }
}

/* ── Badges ──────────────────────────────────────────────── */

export function statusBadge(status) {
  const map = {
    'Pending':   '<span class="badge badge-warning">Pending</span>',
    'Completed': '<span class="badge badge-success">Completed</span>',
    'Cancelled': '<span class="badge badge-danger">Cancelled</span>',
  };
  return map[status] || `<span class="badge badge-gray">${escapeHtml(status)}</span>`;
}

export function serviceBadge(type) {
  const map = {
    'Pickup':   '<span class="badge badge-info">Pickup</span>',
    'Delivery': '<span class="badge badge-purple">Delivery</span>',
    'Custom':   '<span class="badge badge-gray">Custom</span>',
  };
  return map[type] || `<span class="badge badge-gray">${escapeHtml(type)}</span>`;
}

export function roleBadge(role) {
  const map = {
    'admin':        '<span class="badge badge-navy">Admin</span>',
    'office_staff': '<span class="badge badge-info">Office Staff</span>',
    'salesperson':  '<span class="badge badge-gray">Salesperson</span>',
  };
  return map[role] || `<span class="badge badge-gray">${escapeHtml(role)}</span>`;
}

export function roleLabel(role) {
  const map = { admin: 'Admin', office_staff: 'Office Staff', salesperson: 'Salesperson' };
  return map[role] || role;
}

/* ── Helpers ─────────────────────────────────────────────── */

export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function initials(name = '') {
  return String(name).trim().split(/\s+/).map(w => w[0] || '').join('').toUpperCase().slice(0, 2) || '?';
}

export function debounce(fn, delay = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

/** Set button into loading state; returns a restore function */
export function btnLoading(btn, text = 'Loading…') {
  const orig = btn.textContent;
  btn.disabled = true;
  btn.classList.add('btn-loading');
  btn.dataset.origText = orig;
  // We add a visually hidden span for accessibility
  btn.textContent = text;
  return () => {
    btn.disabled = false;
    btn.classList.remove('btn-loading');
    btn.textContent = orig;
  };
}

/** Render a simple loading indicator */
export function loadingHTML(text = 'Loading…') {
  return `<div class="loading-inline"><div class="spinner-sm"></div>${escapeHtml(text)}</div>`;
}

/** Render error message */
export function errorHTML(msg) {
  return `<div class="alert alert-danger"><span>⚠</span> ${escapeHtml(msg)}</div>`;
}

/** Render empty state */
export function emptyStateHTML(title, subtitle = '', icon = '') {
  return `
    <div class="empty-state">
      ${icon ? `<div class="empty-state-icon">${icon}</div>` : `<svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2"/></svg>`}
      <div class="empty-state-title">${escapeHtml(title)}</div>
      ${subtitle ? `<div class="empty-state-subtitle">${escapeHtml(subtitle)}</div>` : ''}
    </div>`;
}

/** Build SVG icon string (inline, stroke-based) */
export const icons = {
  dashboard: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
  calendar: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  users: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  customers: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  bookings: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,
  schedule: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>`,
  bell: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
  history: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.95"/></svg>`,
  logout: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
  print: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>`,
  plus: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  edit: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  trash: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>`,
  eye: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
  search: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
  check: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  x: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
};
