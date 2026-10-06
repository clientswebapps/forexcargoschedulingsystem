/**
 * presence.js — Real-time User Presence & Activity Heartbeat
 * Tracks online status, current active page, device, and last seen timestamps.
 */
'use strict';
import { Users, serverTs } from './db.js';

let presenceInterval = null;
let currentUid = null;

/** Get a clean human-readable device/platform string */
function getDeviceInfo() {
  const ua = navigator.userAgent;
  let os = 'Unknown OS';
  if (ua.includes('Win')) os = 'Windows';
  else if (ua.includes('Mac')) os = 'macOS';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('Linux')) os = 'Linux';

  let browser = 'Browser';
  if (ua.includes('Chrome') && !ua.includes('Edg')) browser = 'Chrome';
  else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
  else if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Edg')) browser = 'Edge';

  return `${os} (${browser})`;
}

/** Initialize presence tracking when user logs in */
export function initPresence(uid) {
  if (!uid) return;
  currentUid = uid;

  const device = getDeviceInfo();

  // 1. Initial login update
  try {
    Users.update(uid, {
      isOnline: true,
      lastActive: serverTs(),
      lastLogin: serverTs(),
      device: device,
      currentRoute: getRouteName(window.location.hash || '#/'),
    }).catch(() => {});
  } catch (_) {}

  // 2. Periodic heartbeat every 3 minutes (calibrated to conserve Firestore writes)
  if (presenceInterval) clearInterval(presenceInterval);
  presenceInterval = setInterval(() => {
    if (!currentUid || !firebase.auth().currentUser) return;
    try {
      Users.update(currentUid, {
        isOnline: !document.hidden,
        lastActive: serverTs(),
        currentRoute: getRouteName(window.location.hash || '#/'),
      }).catch(() => {});
    } catch (_) {}
  }, 180000);

  // 3. Tab visibility change (active vs background)
  document.addEventListener('visibilitychange', () => {
    if (!currentUid || !firebase.auth().currentUser) return;
    try {
      Users.update(currentUid, {
        isOnline: !document.hidden,
        lastActive: serverTs(),
      }).catch(() => {});
    } catch (_) {}
  });

  // 4. Unload / Close Tab handler
  window.addEventListener('beforeunload', () => {
    if (currentUid && firebase.auth().currentUser) {
      try {
        Users.update(currentUid, {
          isOnline: false,
          lastActive: serverTs(),
        }).catch(() => {});
      } catch (_) {}
    }
  });
}

let lastPresenceRoute = '';
let lastPresenceRouteTs = 0;

/** Update the current active page in presence (throttled to avoid rapid write spam) */
export function updatePresenceRoute(hash) {
  if (!currentUid || !firebase.auth().currentUser) return;
  const newRoute = getRouteName(hash);
  if (newRoute === lastPresenceRoute && (Date.now() - lastPresenceRouteTs < 120000)) return;
  lastPresenceRoute = newRoute;
  lastPresenceRouteTs = Date.now();
  try {
    Users.update(currentUid, {
      isOnline: true,
      lastActive: serverTs(),
      currentRoute: newRoute,
    }).catch(() => {});
  } catch (_) {}
}

/** Stop presence tracking on logout */
export async function stopPresence() {
  if (presenceInterval) {
    clearInterval(presenceInterval);
    presenceInterval = null;
  }
  if (currentUid && firebase.auth().currentUser) {
    try {
      await Users.update(currentUid, {
        isOnline: false,
        lastActive: serverTs(),
      });
    } catch (_) {}
  }
  currentUid = null;
}

/** Convert route hash to clean title */
function getRouteName(hash) {
  const clean = hash.replace(/^#/, '').split('?')[0] || '/';
  if (clean === '/' || clean === '' || clean === '/dashboard') return 'Dashboard';
  if (clean.startsWith('/schedules/new') || clean.startsWith('/bookings/new')) return 'Creating Schedule';
  if (clean.startsWith('/schedules/edit') || clean.startsWith('/bookings/edit')) return 'Editing Schedule';
  if (clean.startsWith('/schedules/view') || clean.startsWith('/bookings/view')) return 'Viewing Schedule Detail';
  if (clean.startsWith('/schedules') || clean.startsWith('/bookings')) return 'Schedules List';
  if (clean.startsWith('/my-schedule')) return 'My Schedule';
  if (clean.startsWith('/customers')) return 'Customers Management';
  if (clean.startsWith('/users')) return 'User Management';
  if (clean.startsWith('/staff-activity')) return 'Staff Activity Monitor';
  if (clean.startsWith('/notifications')) return 'Notifications';
  if (clean.startsWith('/activity-log')) return 'Activity Audit Log';
  if (clean.startsWith('/print')) return 'Printing Schedules';
  return 'In App';
}

/** Calculate presence status: 'online' | 'idle' | 'offline' */
export function getPresenceStatus(user) {
  if (!user) return { status: 'offline', label: 'Offline', color: 'gray' };
  
  const lastActive = user.lastActive?.toDate ? user.lastActive.toDate() : (user.lastActive ? new Date(user.lastActive) : null);
  if (!lastActive) {
    return { status: 'offline', label: 'Offline (Never)', color: 'gray' };
  }

  const diffMs = Date.now() - lastActive.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (user.isOnline !== false && diffMins < 5) {
    return { status: 'online', label: 'Online now', color: 'green', isOnline: true };
  }
  if (diffMins < 20) {
    return { status: 'idle', label: `Idle (${diffMins}m ago)`, color: 'amber', isIdle: true };
  }
  
  return { status: 'offline', label: 'Offline', color: 'gray', lastSeen: lastActive };
}
