/**
 * print.js — Printable Schedule View
 * Print header format (D6/D7):
 *   With salesperson: "Forex Cargo Schedule + Salesperson Name: [name] Date: [date]"
 *   Without:          "Forex Cargo Schedule Date: [date]"
 */
'use strict';
import { Bookings } from '../db.js';
import { formatDateTime, formatDate, formatBookingDateTime, formatBookingTime, statusBadge, serviceBadge, loadingHTML, errorHTML, escapeHtml } from '../utils.js';

export async function renderPrint(container, appState, queryString = '') {
  const params = new URLSearchParams(queryString);
  const salespersonId   = params.get('salespersonId') || '';
  const salespersonName = params.get('salespersonName') || '';
  const dateFrom        = params.get('dateFrom') || '';
  const dateTo          = params.get('dateTo') || '';
  const status          = params.get('status') || '';
  const serviceType     = params.get('serviceType') || '';
  const scheduledPeriod = params.get('scheduledPeriod') || '';
  const rangeType       = params.get('rangeType') || '';

  const role  = appState.user.role;
  const uid   = appState.uid;
  const isSales = role === 'salesperson';

  // Build print header
  const today = new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
  const dateRange = dateFrom || dateTo
    ? (dateFrom && dateTo ? `${dateFrom} to ${dateTo}` : dateFrom || dateTo)
    : today;

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const todayYMD = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const isTodayPrint = rangeType === 'today' || (dateFrom === todayYMD && dateTo === todayYMD) || (!rangeType && !dateFrom && !dateTo);

  const effectiveSalesName = isSales ? appState.user.displayName : (salespersonName || '');
  const showSalespersonColumn = !effectiveSalesName;

  // Filter summary for print
  const filterParts = [];
  if (status)      filterParts.push(`Status: ${status}`);
  if (serviceType) filterParts.push(`Service: ${serviceType}`);
  if (dateFrom)    filterParts.push(`From: ${dateFrom}`);
  if (dateTo)      filterParts.push(`To: ${dateTo}`);

  container.innerHTML = `
    <div class="page-header no-print">
      <div class="page-header-left">
        <h1 class="page-title">Print Preview</h1>
        <div class="page-subtitle">Review and print the schedule below</div>
      </div>
      <div class="page-actions" id="print-controls">
        <button class="btn btn-secondary" onclick="window._navigate && window._navigate(-1)">← Back</button>
        <button class="btn btn-primary" onclick="window.print()">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          Print
        </button>
      </div>
    </div>

    <div id="print-document">
      <!-- Print Header (visible in print and in preview) -->
      <div class="print-header" style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;padding-bottom:16px;border-bottom:3px solid var(--navy);">
        <div style="font-size:1.3rem;font-weight:700;color:var(--navy);">Forex Cargo Schedule</div>
        <div style="text-align:right;">
          <div style="font-size:0.8rem;color:var(--medium-gray);">Printed on: ${today}</div>
          ${effectiveSalesName ? `<div style="font-size:1.1rem;font-weight:600;color:var(--navy);margin-top:4px;">Salesperson: ${escapeHtml(effectiveSalesName)}</div>` : ''}
        </div>
      </div>

      <!-- Table -->
      <div id="print-table-area">${loadingHTML()}</div>
    </div>`;

  try {
    let bookings = [];
    if (isSales) {
      // Salesperson always sees only their own
      bookings = await Bookings.getMine(uid, {
        dateFrom:        dateFrom || undefined,
        dateTo:          dateTo   || undefined,
        status:          status   || undefined,
        scheduledPeriod: scheduledPeriod || undefined,
      });
    } else {
      const effectiveSalesId = isSales ? uid : (salespersonId || undefined);
      bookings = await Bookings.getAll({
        salespersonId:   effectiveSalesId,
        dateFrom:        dateFrom        || undefined,
        dateTo:          dateTo          || undefined,
        status:          status          || undefined,
        serviceType:     serviceType     || undefined,
        scheduledPeriod: scheduledPeriod || undefined,
      });
    }

    const tableEl = document.getElementById('print-table-area');
    if (!bookings.length) {
      tableEl.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-secondary);">
        No schedules found for the selected filters.</div>`;
      return;
    }

    tableEl.innerHTML = `
      <div class="table-wrapper">
        <table>
          <thead><tr>
            <th>#</th>
            ${!isTodayPrint ? '<th>Date</th>' : ''}
            <th>Time</th>
            <th>Customer Name</th>
            <th>Contact Number</th>
            <th>Address</th>
            <th>Service</th>
            ${showSalespersonColumn ? '<th>Salesperson</th>' : ''}
            <th>Booked By</th>
            <th class="col-remarks">Remarks</th>
          </tr></thead>
          <tbody>
            ${bookings.map((b, i) => `
              <tr>
                <td class="text-sm text-secondary">${i + 1}</td>
                ${!isTodayPrint ? `<td class="text-sm" style="white-space:nowrap">${formatDate(b.scheduledDate)}</td>` : ''}
                <td class="text-sm" style="white-space:nowrap">${formatBookingTime(b)}</td>
                <td><div class="font-medium">${escapeHtml(b.snapshot_name)}</div></td>
                <td class="text-sm">${escapeHtml(b.snapshot_contactNumber)}</td>
                <td class="text-sm text-secondary">${escapeHtml(b.snapshot_address || '—')}</td>
                <td>
                  ${serviceBadge(b.serviceType)}
                  ${b.serviceDetails ? `<div class="text-xs text-secondary mt-1">${escapeHtml(b.serviceDetails.slice(0,60))}${b.serviceDetails.length>60?'…':''}</div>` : ''}
                  ${b.notes ? `<div class="text-xs text-secondary" style="font-style:italic">${escapeHtml(b.notes.slice(0,40))}</div>` : ''}
                </td>
                ${showSalespersonColumn ? `<td class="text-sm">${escapeHtml(b.salespersonName || '—')}</td>` : ''}
                <td class="text-sm text-secondary">${escapeHtml(b.bookedByName || '—')}</td>
                <td class="col-remarks"></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;

  } catch (err) {
    document.getElementById('print-table-area').innerHTML = errorHTML('Failed to load schedules for printing.');
  }
}
