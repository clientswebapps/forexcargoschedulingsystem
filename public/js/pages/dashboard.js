/**
 * dashboard.js — Dashboard page
 */
'use strict';
import { Bookings, Notifications } from '../db.js';
import { formatDateTime, formatBookingDateTime, formatBookingTime, statusBadge, serviceBadge, loadingHTML, errorHTML, escapeHtml, timeAgo } from '../utils.js';

export async function renderDashboard(container, appState) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Dashboard</h1>
        <div class="page-subtitle">Welcome back, ${escapeHtml(appState.user.displayName || 'User')}</div>
      </div>
    </div>
    <div class="stats-grid" id="dash-stats">${loadingHTML()}</div>
    
    <!-- Analytics Chart -->
    <div class="card" style="margin-bottom:20px;" id="dash-chart-card">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;padding: 14px 20px;">
        <div>
          <div class="card-title">Schedule Volume Analytics</div>
          <div class="card-subtitle">Overview of schedule counts over time</div>
        </div>
        <div class="tabs" style="margin-bottom:0;border-bottom:none;display:flex;gap:4px;">
          <button class="tab-btn active" id="chart-tab-daily" style="padding:6px 12px;font-size:0.75rem;">Daily</button>
          <button class="tab-btn" id="chart-tab-weekly" style="padding:6px 12px;font-size:0.75rem;">Weekly</button>
          <button class="tab-btn" id="chart-tab-monthly" style="padding:6px 12px;font-size:0.75rem;">Monthly</button>
        </div>
      </div>
      <div class="card-body" id="dash-chart" style="min-height:180px;display:flex;align-items:center;justify-content:center;padding:20px 24px;">
        ${loadingHTML('Loading analytics…')}
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;flex-wrap:wrap;" id="dash-grid">
      <div class="card" id="dash-upcoming-card">
        <div class="card-header">
          <div>
            <div class="card-title">Today\'s Schedules</div>
            <div class="card-subtitle">Scheduled for today</div>
          </div>
        </div>
        <div id="dash-upcoming">${loadingHTML()}</div>
      </div>
      <div class="card" id="dash-notif-card">
        <div class="card-header">
          <div class="card-title">Recent Notifications</div>
        </div>
        <div id="dash-notif">${loadingHTML()}</div>
      </div>
    </div>`;

  // Responsive grid
  const grid = document.getElementById('dash-grid');
  const setGrid = () => {
    grid.style.gridTemplateColumns = window.innerWidth < 768 ? '1fr' : '1fr 1fr';
  };
  setGrid();
  window.addEventListener('resize', setGrid);

  let unsubs = [];

  try {
    const role = appState.user.role;
    const uid  = appState.uid;

    const today = new Date(); today.setHours(0,0,0,0);
    const pad = n => String(n).padStart(2, '0');
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

    let allToday = [];
    let pendingAll = [];

    function renderStats() {
      const statsEl = document.getElementById('dash-stats');
      if (!statsEl) return;
      statsEl.innerHTML = `
        <div class="stat-card">
          <div class="stat-icon blue">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          </div>
          <div>
            <div class="stat-value">${allToday.length}</div>
            <div class="stat-label">Today\'s Schedules</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon orange">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
          <div>
            <div class="stat-value">${pendingAll.length}</div>
            <div class="stat-label">Pending Schedules</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon green">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <div>
            <div class="stat-value">${allToday.filter(b => b.status === 'Completed').length}</div>
            <div class="stat-label">Completed Today</div>
          </div>
        </div>
        ${role !== 'salesperson' ? `
        <div class="stat-card">
          <div class="stat-icon red">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
          </div>
          <div>
            <div class="stat-value">${allToday.filter(b => b.status === 'Cancelled').length}</div>
            <div class="stat-label">Cancelled Today</div>
          </div>
        </div>` : ''}`;
    }

    function renderUpcoming() {
      const upcomingEl = document.getElementById('dash-upcoming');
      if (!upcomingEl) return;
      if (allToday.length === 0) {
        upcomingEl.innerHTML = `<div class="table-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          No schedules for today</div>`;
      } else {
        upcomingEl.innerHTML = `
          <div class="table-wrapper" style="border-radius:0;border:none;box-shadow:none;">
            <table>
              <thead><tr>
                <th>Time</th><th>Customer</th><th>Service</th><th>Salesperson</th><th>Status</th>
              </tr></thead>
              <tbody>
                ${allToday.map(b => `
                  <tr class="clickable" data-id="${b.id}" onclick="window._navigate && window._navigate('/schedules/view/${b.id}')">
                    <td class="text-sm">${formatBookingTime(b)}</td>
                    <td><div class="font-medium">${escapeHtml(b.snapshot_name)}</div>
                        <div class="text-xs text-secondary">${escapeHtml(b.snapshot_contactNumber)}</div></td>
                    <td>${serviceBadge(b.serviceType)}</td>
                    <td class="text-sm">${escapeHtml(b.salespersonName || '—')}</td>
                    <td>${statusBadge(b.status)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>`;
      }
    }

    // 1. Real-time listener for Today's schedules
    const unsubToday = role === 'salesperson'
      ? Bookings.onMineSnapshot(uid, { dateFrom: todayStr, dateTo: todayStr }, records => {
          allToday = records;
          renderStats();
          renderUpcoming();
        })
      : Bookings.onAllSnapshot({ dateFrom: todayStr, dateTo: todayStr }, records => {
          allToday = records;
          renderStats();
          renderUpcoming();
        });
    unsubs.push(unsubToday);

    // 2. Real-time listener for Pending schedules count
    const unsubPending = role === 'salesperson'
      ? Bookings.onMineSnapshot(uid, { status: 'Pending' }, records => {
          pendingAll = records;
          renderStats();
        })
      : Bookings.onAllSnapshot({ status: 'Pending' }, records => {
          pendingAll = records;
          renderStats();
        });
    unsubs.push(unsubPending);

    // 3. Real-time listener for notifications
    const unsubNotif = Notifications.onSnapshot(uid, notifs => {
      const notifEl = document.getElementById('dash-notif');
      if (!notifEl) return;
      const recent = notifs.slice(0, 6);
      if (recent.length === 0) {
        notifEl.innerHTML = `<div class="table-empty">No notifications yet</div>`;
      } else {
        notifEl.innerHTML = recent.map(n => `
          <div class="notif-item ${n.read ? '' : 'unread'}" onclick="window._navigate && window._navigate('/notifications')">
            <div class="notif-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            </div>
            <div class="notif-content">
              <div class="notif-message">${escapeHtml(n.message)}</div>
              <div class="notif-time">${timeAgo(n.createdAt)}</div>
            </div>
            ${!n.read ? '<div class="notif-dot"></div>' : ''}
          </div>`).join('');
      }
    });
    unsubs.push(unsubNotif);

    // 4. One-time fetch for statistics chart
    (async () => {
      try {
        const chartStartDate = new Date();
        chartStartDate.setMonth(chartStartDate.getMonth() - 6);
        chartStartDate.setHours(0,0,0,0);
        const dateFromStr = `${chartStartDate.getFullYear()}-${pad(chartStartDate.getMonth() + 1)}-${pad(chartStartDate.getDate())}`;

        let bookingsList = [];
        if (role === 'salesperson') {
          bookingsList = await Bookings.getMine(uid, { dateFrom: dateFromStr });
        } else {
          bookingsList = await Bookings.getAll({ dateFrom: dateFromStr });
        }

        // Daily (last 7 days)
        const dailyData = [];
        const dailyLabels = [];
        for (let i = 6; i >= 0; i--) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
          const count = bookingsList.filter(b => {
            const bDate = b.scheduledDate && b.scheduledDate.toDate ? b.scheduledDate.toDate() : new Date(b.scheduledDate);
            const bDateStr = `${bDate.getFullYear()}-${pad(bDate.getMonth() + 1)}-${pad(bDate.getDate())}`;
            return bDateStr === dateStr;
          }).length;
          dailyData.push(count);
          dailyLabels.push(d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }));
        }

        // Weekly (last 4 weeks)
        const weeklyData = [];
        const weeklyLabels = [];
        for (let i = 3; i >= 0; i--) {
          const start = new Date();
          start.setDate(start.getDate() - (i + 1) * 7 + 1);
          start.setHours(0,0,0,0);
          const end = new Date();
          end.setDate(end.getDate() - i * 7);
          end.setHours(23,59,59,999);
          const count = bookingsList.filter(b => {
            const bDate = b.scheduledDate && b.scheduledDate.toDate ? b.scheduledDate.toDate() : new Date(b.scheduledDate);
            return bDate >= start && bDate <= end;
          }).length;
          weeklyData.push(count);
          const startLabel = start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
          const endLabel = end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
          weeklyLabels.push(`${startLabel} - ${endLabel}`);
        }

        // Monthly (last 6 months)
        const monthlyData = [];
        const monthlyLabels = [];
        for (let i = 5; i >= 0; i--) {
          const d = new Date();
          d.setMonth(d.getMonth() - i);
          const year = d.getFullYear();
          const month = d.getMonth();
          const count = bookingsList.filter(b => {
            const bDate = b.scheduledDate && b.scheduledDate.toDate ? b.scheduledDate.toDate() : new Date(b.scheduledDate);
            return bDate.getFullYear() === year && bDate.getMonth() === month;
          }).length;
          monthlyData.push(count);
          monthlyLabels.push(d.toLocaleDateString('en-GB', { month: 'short' }));
        }

        function updateChart(type) {
          const chartEl = document.getElementById('dash-chart');
          if (!chartEl) return;
          ['daily', 'weekly', 'monthly'].forEach(t => {
            const btn = document.getElementById(`chart-tab-${t}`);
            if (btn) {
              if (t === type) btn.classList.add('active');
              else btn.classList.remove('active');
            }
          });
          if (type === 'daily') {
            chartEl.innerHTML = generateLineChartSVG(dailyData, dailyLabels);
          } else if (type === 'weekly') {
            chartEl.innerHTML = generateLineChartSVG(weeklyData, weeklyLabels);
          } else {
            chartEl.innerHTML = generateLineChartSVG(monthlyData, monthlyLabels);
          }
        }

        document.getElementById('chart-tab-daily')?.addEventListener('click', () => updateChart('daily'));
        document.getElementById('chart-tab-weekly')?.addEventListener('click', () => updateChart('weekly'));
        document.getElementById('chart-tab-monthly')?.addEventListener('click', () => updateChart('monthly'));

        updateChart('daily');

      } catch (err) {
        console.error('Chart analytics load error:', err);
        const chartEl = document.getElementById('dash-chart');
        if (chartEl) chartEl.innerHTML = errorHTML('Failed to load chart analytics.');
      }
    })();

  } catch (err) {
    console.error('Dashboard error:', err);
    document.getElementById('dash-stats').innerHTML = errorHTML('Failed to load dashboard data.');
    document.getElementById('dash-upcoming').innerHTML = '';
    document.getElementById('dash-notif').innerHTML = '';
  }

  // Return cleanup function to unsubscribe from all listeners when navigating away
  return () => {
    unsubs.forEach(fn => { if (typeof fn === 'function') fn(); });
    unsubs = [];
    window.removeEventListener('resize', setGrid);
  };
}

function generateLineChartSVG(data, labels) {
  const width = 500;
  const height = 180;
  const padLeft = 28;
  const padRight = 20;
  const padTop = 22;
  const padBottom = 30;

  const chartWidth = width - padLeft - padRight;
  const chartHeight = height - padTop - padBottom;
  const chartBottom = padTop + chartHeight;

  const rawMax = Math.max(...data, 0);
  let maxVal = Math.max(rawMax, 4);
  if (maxVal % 2 !== 0) maxVal += 1;
  const midVal = Math.round(maxVal / 2);

  const n = data.length;
  const points = data.map((val, i) => {
    const x = n > 1 ? padLeft + i * (chartWidth / (n - 1)) : width / 2;
    const y = chartBottom - (val / maxVal) * chartHeight;
    return { x, y, val, label: labels[i] };
  });

  // Smooth Catmull-Rom to Cubic Bézier spline with baseline clamping
  let lineD = '';
  if (points.length === 1) {
    lineD = `M ${points[0].x - 20} ${points[0].y} L ${points[0].x + 20} ${points[0].y}`;
  } else {
    lineD = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i === 0 ? 0 : i - 1];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] || p2;

      // If both points are 0, flat straight line along baseline
      if (p1.val === 0 && p2.val === 0) {
        lineD += ` L ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
        continue;
      }

      let cp1x = p1.x + (p2.x - p0.x) / 6;
      let cp1y = p1.y + (p2.y - p0.y) / 6;

      let cp2x = p2.x - (p3.x - p1.x) / 6;
      let cp2y = p2.y - (p3.y - p1.y) / 6;

      // Clamp control points within bounds to prevent dipping below baseline
      cp1y = Math.min(chartBottom, Math.max(padTop, cp1y));
      cp2y = Math.min(chartBottom, Math.max(padTop, cp2y));

      lineD += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
  }

  // Area fill below line
  const areaD = points.length > 1
    ? `${lineD} L ${points[points.length - 1].x.toFixed(1)} ${chartBottom} L ${points[0].x.toFixed(1)} ${chartBottom} Z`
    : '';

  const pointsSVG = points.map((p) => {
    return `
      <g class="chart-point-group" style="cursor:pointer;">
        <!-- Vertical guide line on hover -->
        <line class="chart-hover-line" x1="${p.x.toFixed(1)}" y1="${padTop}" x2="${p.x.toFixed(1)}" y2="${chartBottom}" stroke="rgba(25,118,210,0.18)" stroke-width="1" stroke-dasharray="2,2" />
        <!-- Value text above dot (smaller, tiny) -->
        <text class="point-val" x="${p.x.toFixed(1)}" y="${(p.y - 6).toFixed(1)}" text-anchor="middle" font-size="0.58rem" font-weight="600" fill="${p.val > 0 ? 'var(--navy)' : 'var(--text-hint)'}">${p.val}</text>
        <!-- Outer glowing dot (smaller, tiny) -->
        <circle class="point-circle" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.75" fill="#0D47A1" stroke="#FFFFFF" stroke-width="1.5" />
        <!-- Hover target -->
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="16" fill="transparent">
          <title>${escapeHtml(p.label)}: ${p.val} schedule(s)</title>
        </circle>
        <!-- X-axis date label (smaller, tiny) -->
        <text x="${p.x.toFixed(1)}" y="${(height - 8).toFixed(1)}" text-anchor="middle" font-size="0.58rem" font-weight="500" fill="var(--text-secondary)">${escapeHtml(p.label)}</text>
      </g>
    `;
  }).join('');

  return `
    <svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" style="overflow:visible;">
      <defs>
        <linearGradient id="lineAreaGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#1976D2" stop-opacity="0.18" />
          <stop offset="100%" stop-color="#1976D2" stop-opacity="0.0" />
        </linearGradient>
        <linearGradient id="lineStrokeGradient" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#42A5F5" />
          <stop offset="100%" stop-color="#0D47A1" />
        </linearGradient>
        <filter id="lineShadow" x="-10%" y="-10%" width="120%" height="130%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" flood-color="#0D47A1" flood-opacity="0.15" />
        </filter>
      </defs>

      <!-- Horizontal Grid Lines & Y-Labels (smaller, tiny) -->
      <line x1="${padLeft}" y1="${padTop}" x2="${width - padRight}" y2="${padTop}" stroke="var(--border-gray)" stroke-width="1" stroke-dasharray="3,3" />
      <text x="${padLeft - 5}" y="${padTop + 3.5}" text-anchor="end" font-size="0.55rem" font-weight="500" fill="var(--text-hint)">${maxVal}</text>

      <line x1="${padLeft}" y1="${padTop + chartHeight / 2}" x2="${width - padRight}" y2="${padTop + chartHeight / 2}" stroke="var(--border-gray)" stroke-width="1" stroke-dasharray="3,3" />
      <text x="${padLeft - 5}" y="${padTop + chartHeight / 2 + 3.5}" text-anchor="end" font-size="0.55rem" font-weight="500" fill="var(--text-hint)">${midVal}</text>

      <line x1="${padLeft}" y1="${chartBottom}" x2="${width - padRight}" y2="${chartBottom}" stroke="var(--border-gray)" stroke-width="1" />
      <text x="${padLeft - 5}" y="${chartBottom + 3}" text-anchor="end" font-size="0.55rem" font-weight="500" fill="var(--text-hint)">0</text>

      <!-- Gradient Area Fill -->
      ${areaD ? `<path d="${areaD}" fill="url(#lineAreaGradient)" />` : ''}

      <!-- Line Stroke with Shadow (thinner: 1.8px) -->
      <path d="${lineD}" fill="none" stroke="url(#lineStrokeGradient)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" filter="url(#lineShadow)" />

      <!-- Data Points & Labels -->
      ${pointsSVG}
    </svg>
  `;
}
