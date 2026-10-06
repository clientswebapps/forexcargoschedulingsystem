/**
 * db.js — Firestore data access layer
 * Forex Cargo Scheduling System
 *
 * All Firestore reads/writes go through this module.
 * The `firebase` global is provided by the Firebase compat SDK.
 */

'use strict';

const db  = firebase.firestore();
const auth = firebase.auth();

// Enable IndexedDB offline persistence with multi-tab synchronization
try {
  db.enablePersistence({ synchronizeTabs: true }).catch(err => {
    if (err.code !== 'failed-precondition' && err.code !== 'unimplemented') {
      console.warn('Firestore persistence notice:', err.message);
    }
  });
} catch (_) {}

/* ── Helpers ─────────────────────────────────────────────── */

export const serverTs = () => firebase.firestore.FieldValue.serverTimestamp();
const currentUid = () => auth.currentUser && auth.currentUser.uid;

function docData(snap) {
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

function collData(snap) {
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Normalize contact numbers for fast prefix queries */
export function normalizePhone(rawPhone) {
  if (!rawPhone) return { phoneClean: '', phoneLocal: '' };
  const phoneClean = String(rawPhone).replace(/\D/g, '');
  let phoneLocal = phoneClean;
  if (phoneClean.startsWith('973') && phoneClean.length > 3) {
    phoneLocal = phoneClean.substring(3);
  }
  return { phoneClean, phoneLocal };
}

/* ── USERS ───────────────────────────────────────────────── */

let _usersCache = null;
let _usersCacheTs = 0;
const USER_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export const Users = {
  col: () => db.collection('users'),
  doc: (uid) => db.collection('users').doc(uid),

  async get(uid) {
    return docData(await db.collection('users').doc(uid).get());
  },

  async getAll(useCache = true) {
    if (useCache && _usersCache && (Date.now() - _usersCacheTs < USER_CACHE_TTL)) {
      return _usersCache;
    }
    const snap = await db.collection('users').orderBy('displayName').get();
    _usersCache = collData(snap);
    _usersCacheTs = Date.now();
    return _usersCache;
  },

  invalidateCache() {
    _usersCache = null;
    _usersCacheTs = 0;
  },

  async getByRole(role) {
    const snap = await db.collection('users').where('role', '==', role).orderBy('displayName').get();
    return collData(snap);
  },

  async getActiveSalespersons(includeInvisible = false) {
    const all = await this.getAll(true);
    return all
      .filter(u => u.role === 'salesperson' && u.isActive !== false && (includeInvisible || !u.isInvisible))
      .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
  },

  async getActiveStaff(includeInvisible = false) {
    const all = await this.getAll(true);
    return all
      .filter(u => u.isActive !== false && u.role !== 'super_admin' && (includeInvisible || !u.isInvisible))
      .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
  },

  async create(uid, data) {
    const doc = {
      displayName: data.displayName,
      email:       data.email,
      role:        data.role,
      isInvisible: !!data.isInvisible,
      isActive:    true,
      createdAt:   serverTs(),
      updatedAt:   serverTs(),
    };
    await db.collection('users').doc(uid).set(doc);
    this.invalidateCache();
    return { id: uid, ...doc };
  },

  async update(uid, data) {
    const updates = { ...data, updatedAt: serverTs() };
    await db.collection('users').doc(uid).update(updates);
    this.invalidateCache();
  },

  onSnapshot(callback, errorCallback) {
    return db.collection('users').orderBy('displayName').onSnapshot(
      snap => {
        const data = collData(snap);
        _usersCache = data;
        _usersCacheTs = Date.now();
        callback(data);
      },
      err => {
        if (!firebase.auth().currentUser || err?.code === 'permission-denied') return;
        console.error('Users onSnapshot error:', err);
        if (errorCallback) errorCallback(err);
      }
    );
  },
};

/* ── CUSTOMERS ───────────────────────────────────────────── */

let _customersCache = null;
let _customersCacheTs = 0;
const CUSTOMERS_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

export const Customers = {
  col: () => db.collection('customers'),

  async get(id) {
    return docData(await db.collection('customers').doc(id).get());
  },

  async getAll() {
    return this.getAllCached(false);
  },

  async getAllCached(forceRefresh = false) {
    if (!forceRefresh && _customersCache && (Date.now() - _customersCacheTs < CUSTOMERS_CACHE_TTL)) {
      return _customersCache;
    }
    const snap = await db.collection('customers').orderBy('name').get();
    _customersCache = collData(snap);
    _customersCacheTs = Date.now();
    return _customersCache;
  },

  invalidateCache() {
    _customersCache = null;
    _customersCacheTs = 0;
  },

  /** Paginated fetch of customers */
  async getPaginated(limitCount = 50, startAfterDoc = null) {
    let q = db.collection('customers').orderBy('name').limit(limitCount);
    if (startAfterDoc) {
      q = q.startAfter(startAfterDoc);
    }
    const snap = await q.get();
    return {
      docs: collData(snap),
      lastDoc: snap.docs[snap.docs.length - 1] || null,
      hasMore: snap.docs.length === limitCount,
    };
  },

  /** Search by contact number (targeted prefix query & memory cache, capped at 8 reads) */
  async searchByPhone(phone) {
    if (!phone) return [];
    const { phoneClean, phoneLocal } = normalizePhone(phone);
    if (!phoneLocal && !phoneClean) return [];

    // 1. If in-memory cache is populated and fresh, search locally (0 reads)
    if (_customersCache && (Date.now() - _customersCacheTs < CUSTOMERS_CACHE_TTL)) {
      return _customersCache.filter(c => {
        const cLocal = c.phoneLocal || (c.contactNumber ? normalizePhone(c.contactNumber).phoneLocal : '');
        const cClean = c.phoneClean || (c.contactNumber ? normalizePhone(c.contactNumber).phoneClean : '');
        return (phoneLocal && cLocal.includes(phoneLocal)) || (phoneClean && cClean.includes(phoneClean));
      }).slice(0, 8);
    }

    // 2. Direct Firestore query by phoneLocal prefix (max 8 reads)
    if (phoneLocal) {
      try {
        const snap = await db.collection('customers')
          .where('phoneLocal', '>=', phoneLocal)
          .where('phoneLocal', '<=', phoneLocal + '\uf8ff')
          .limit(8)
          .get();
        const results = collData(snap);
        if (results.length > 0) return results;
      } catch (_) {}
    }

    // 3. Fallback direct Firestore query by phoneClean prefix
    if (phoneClean) {
      try {
        const snap = await db.collection('customers')
          .where('phoneClean', '>=', phoneClean)
          .where('phoneClean', '<=', phoneClean + '\uf8ff')
          .limit(8)
          .get();
        const results = collData(snap);
        if (results.length > 0) return results;
      } catch (_) {}
    }

    // 4. Fallback for unmigrated legacy customer documents: fetch cache once and filter
    const all = await this.getAllCached();
    return all.filter(c => {
      const cLocal = c.phoneLocal || (c.contactNumber ? normalizePhone(c.contactNumber).phoneLocal : '');
      const cClean = c.phoneClean || (c.contactNumber ? normalizePhone(c.contactNumber).phoneClean : '');
      return (phoneLocal && cLocal.includes(phoneLocal)) || (phoneClean && cClean.includes(phoneClean));
    }).slice(0, 8);
  },

  /** Search by name prefix (max 8 reads) */
  async searchByName(name) {
    if (!name) return [];
    const end = name.toLowerCase() + '\uf8ff';
    const snap = await db.collection('customers')
      .where('nameLower', '>=', name.toLowerCase())
      .where('nameLower', '<=', end)
      .limit(8)
      .get();
    return collData(snap);
  },

  async create(data) {
    const { phoneClean, phoneLocal } = normalizePhone(data.contactNumber);
    const doc = {
      name:          data.name,
      nameLower:     data.name.toLowerCase(),
      contactNumber: data.contactNumber,
      phoneClean,
      phoneLocal,
      address:       data.address || '',
      createdBy:     currentUid(),
      createdAt:     serverTs(),
      updatedAt:     serverTs(),
    };
    const ref = await db.collection('customers').add(doc);
    this.invalidateCache();
    return { id: ref.id, ...doc };
  },

  async update(id, data) {
    const { phoneClean, phoneLocal } = normalizePhone(data.contactNumber);
    const updates = {
      name:          data.name,
      nameLower:     data.name.toLowerCase(),
      contactNumber: data.contactNumber,
      phoneClean,
      phoneLocal,
      address:       data.address || '',
      updatedAt:     serverTs(),
    };
    await db.collection('customers').doc(id).update(updates);
    this.invalidateCache();
  },

  async delete(id) {
    await db.collection('customers').doc(id).delete();
    this.invalidateCache();
  },

  onSnapshot(callback, errorCallback) {
    return db.collection('customers').orderBy('name').onSnapshot(
      snap => {
        const data = collData(snap);
        _customersCache = data;
        _customersCacheTs = Date.now();
        callback(data);
      },
      err => {
        if (!firebase.auth().currentUser || err?.code === 'permission-denied') return;
        console.error('Customers onSnapshot error:', err);
        if (errorCallback) errorCallback(err);
      }
    );
  },
};

/* Helper to parse YYYY-MM-DD in local time and convert to Firestore Timestamp */
function parseLocalDate(ymdString, isEnd = false) {
  if (!ymdString) return null;
  const [y, m, d] = ymdString.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (isEnd) {
    date.setHours(23, 59, 59, 999);
  } else {
    date.setHours(0, 0, 0, 0);
  }
  return firebase.firestore.Timestamp.fromDate(date);
}

/* ── BOOKINGS ────────────────────────────────────────────── */

export const Bookings = {
  col: () => db.collection('bookings'),

  async get(id) {
    return docData(await db.collection('bookings').doc(id).get());
  },

  /** Build Firestore query for all schedules (Admin/Office) with optional filters */
  buildQuery(filters = {}, maxLimit = null) {
    let q = db.collection('bookings');

    if (filters.status)        q = q.where('status', '==', filters.status);
    if (filters.serviceType)   q = q.where('serviceType', '==', filters.serviceType);
    if (filters.salespersonId) q = q.where('salespersonId', '==', filters.salespersonId);
    if (filters.bookedById)    q = q.where('bookedById', '==', filters.bookedById);
    if (filters.scheduledPeriod) q = q.where('scheduledPeriod', '==', filters.scheduledPeriod);

    if (filters.dateFrom) {
      q = q.where('scheduledDate', '>=', parseLocalDate(filters.dateFrom, false));
    }
    if (filters.dateTo) {
      q = q.where('scheduledDate', '<=', parseLocalDate(filters.dateTo, true));
    }

    q = q.orderBy('scheduledDate', 'desc');

    // Apply safety limit if specified or when querying across all dates
    const effectiveLimit = maxLimit || (!filters.dateFrom && !filters.dateTo ? 150 : null);
    if (effectiveLimit) {
      q = q.limit(effectiveLimit);
    }

    return q;
  },

  /** Get all bookings (Admin/Office) with optional filters (one-time fetch) */
  async getAll(filters = {}, maxLimit = null) {
    const snap = await this.buildQuery(filters, maxLimit).get();
    return collData(snap);
  },

  /** Real-time listener for all schedules (Admin/Office) with optional filters */
  onAllSnapshot(filters = {}, callback, errorCallback, maxLimit = null) {
    const q = this.buildQuery(filters, maxLimit);
    return q.onSnapshot(
      snap => callback(collData(snap)),
      err => {
        if (!firebase.auth().currentUser || err?.code === 'permission-denied') return;
        console.error('Real-time schedules listener error:', err);
        if (errorCallback) errorCallback(err);
      }
    );
  },

  /** Build query for a specific salesperson's schedules */
  buildMineQuery(salespersonId, filters = {}, maxLimit = null) {
    let q = db.collection('bookings').where('salespersonId', '==', salespersonId);

    if (filters.status) q = q.where('status', '==', filters.status);
    if (filters.scheduledPeriod) q = q.where('scheduledPeriod', '==', filters.scheduledPeriod);

    if (filters.dateFrom) {
      q = q.where('scheduledDate', '>=', parseLocalDate(filters.dateFrom, false));
    }
    if (filters.dateTo) {
      q = q.where('scheduledDate', '<=', parseLocalDate(filters.dateTo, true));
    }

    q = q.orderBy('scheduledDate', 'desc');

    const effectiveLimit = maxLimit || (!filters.dateFrom && !filters.dateTo ? 150 : null);
    if (effectiveLimit) {
      q = q.limit(effectiveLimit);
    }

    return q;
  },

  /** Get bookings for a specific salesperson (their schedule) (one-time fetch) */
  async getMine(salespersonId, filters = {}, maxLimit = null) {
    const snap = await this.buildMineQuery(salespersonId, filters, maxLimit).get();
    return collData(snap);
  },

  /** Real-time listener for a salesperson's schedules */
  onMineSnapshot(salespersonId, filters = {}, callback, errorCallback, maxLimit = null) {
    const q = this.buildMineQuery(salespersonId, filters, maxLimit);
    return q.onSnapshot(
      snap => callback(collData(snap)),
      err => {
        if (!firebase.auth().currentUser) return;
        console.error('Real-time my-schedule listener error:', err);
        if (errorCallback) errorCallback(err);
      }
    );
  },

  /** Get count of pending bookings using Firestore count() aggregation (1 read per 1000 index items) */
  async getPendingCount(salespersonId = null) {
    try {
      let q = db.collection('bookings').where('status', '==', 'Pending');
      if (salespersonId) {
        q = q.where('salespersonId', '==', salespersonId);
      }
      if (typeof q.count === 'function') {
        const snap = await q.count().get();
        return snap.data().count;
      }
      const snap = await q.get();
      return snap.size;
    } catch (e) {
      console.warn('Pending count error:', e);
      return 0;
    }
  },

  async create(data) {
    const doc = {
      serviceType:     data.serviceType,
      serviceDetails:  data.serviceDetails || '',
      customerId:      data.customerId || null,

      // Customer snapshot
      snapshot_name:          data.snapshot_name || '',
      snapshot_contactNumber: data.snapshot_contactNumber || '',
      snapshot_address:       data.snapshot_address || '',

      scheduledDate:   data.scheduledDate,  // Firestore Timestamp
      scheduledTime:   data.scheduledTime || '',
      scheduledPeriod: data.scheduledPeriod || 'Anytime',
      salespersonId:   data.salespersonId,
      salespersonName: data.salespersonName || '',
      notes:           data.notes || '',
      completionNotes: '',
      bookedById:      currentUid(),
      bookedByName:    data.bookedByName || '',
      status:          data.status || 'Pending',
      statusReason:    data.statusReason || '',
      createdAt:       serverTs(),
      updatedAt:       serverTs(),
      updatedById:     currentUid(),
    };
    const ref = await db.collection('bookings').add(doc);
    return { id: ref.id, ...doc };
  },

  async update(id, data) {
    const updates = { ...data, updatedAt: serverTs(), updatedById: currentUid() };
    await db.collection('bookings').doc(id).update(updates);
  },

  /** Salesperson: update completion notes, status, and statusReason */
  async updateSalesperson(id, { completionNotes, status, statusReason }) {
    const data = {
      completionNotes: completionNotes || '',
      status,
      updatedAt:   serverTs(),
      updatedById: currentUid(),
    };
    if (statusReason !== undefined) {
      data.statusReason = statusReason;
    }
    await db.collection('bookings').doc(id).update(data);
  },

  /** Quick status update with optional status reason */
  async updateStatus(id, newStatus, statusReason = '') {
    const data = {
      status:      newStatus,
      statusReason: newStatus === 'Others' ? (statusReason || '') : '',
      updatedAt:   serverTs(),
      updatedById: currentUid(),
    };
    await db.collection('bookings').doc(id).update(data);
  },

  /** Delete a schedule record */
  async delete(id) {
    await db.collection('bookings').doc(id).delete();
  },

  onSnapshot(id, callback, errorCallback) {
    return db.collection('bookings').doc(id).onSnapshot(
      snap => callback(docData(snap)),
      err => {
        if (!firebase.auth().currentUser || err?.code === 'permission-denied') return;
        console.error('Booking onSnapshot error:', err);
        if (errorCallback) errorCallback(err);
      }
    );
  },
};

/* ── NOTIFICATIONS ───────────────────────────────────────── */

export const Notifications = {
  col: () => db.collection('notifications'),

  async getForUser(uid) {
    const snap = await db.collection('notifications')
      .where('recipientId', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();
    return collData(snap);
  },

  async getUnreadCount(uid) {
    const snap = await db.collection('notifications')
      .where('recipientId', '==', uid)
      .where('read', '==', false)
      .get();
    return snap.size;
  },

  async markRead(id) {
    await db.collection('notifications').doc(id).update({ read: true });
  },

  async markAllRead(uid) {
    const snap = await db.collection('notifications')
      .where('recipientId', '==', uid)
      .where('read', '==', false)
      .get();
    const batch = db.batch();
    snap.docs.forEach(d => batch.update(d.ref, { read: true }));
    await batch.commit();
  },

  async create(data) {
    const doc = {
      recipientId: data.recipientId,
      type:        data.type,
      bookingId:   data.bookingId || null,
      message:     data.message,
      read:        false,
      createdAt:   serverTs(),
    };
    await db.collection('notifications').add(doc);
  },

  onSnapshot(uid, callback, errorCallback) {
    return db.collection('notifications')
      .where('recipientId', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .onSnapshot(
        snap => callback(collData(snap)),
        err => {
          if (!firebase.auth().currentUser || err?.code === 'permission-denied') return;
          console.error('Notifications onSnapshot error:', err);
          if (errorCallback) errorCallback(err);
        }
      );
  },
};

/* ── ACTIVITY LOG ────────────────────────────────────────── */

export const ActivityLog = {
  col: () => db.collection('activityLog'),

  async getAll(filters = {}) {
    let q = db.collection('activityLog');
    if (filters.bookingId) q = q.where('bookingId', '==', filters.bookingId);
    q = q.orderBy('timestamp', 'desc').limit(200);
    const snap = await q.get();
    return collData(snap);
  },

  async getForBooking(bookingId) {
    const snap = await db.collection('activityLog')
      .where('bookingId', '==', bookingId)
      .orderBy('timestamp', 'desc')
      .get();
    return collData(snap);
  },

  onSnapshot(filters = {}, callback, errorCallback) {
    let q = db.collection('activityLog');
    if (filters.bookingId) q = q.where('bookingId', '==', filters.bookingId);
    q = q.orderBy('timestamp', 'desc').limit(200);
    return q.onSnapshot(
      snap => callback(collData(snap)),
      err => {
        console.error('Activity log listener error:', err);
        if (errorCallback) errorCallback(err);
      }
    );
  },

  async write({ bookingId, action, details = {} }) {
    const user = auth.currentUser;
    const appUser = window._appState?.user;
    const doc = {
      bookingId:   bookingId || null,
      actorId:     user ? user.uid : null,
      actorName:   user ? (user.displayName || user.email) : 'System',
      actorRole:   appUser?.actualRole || appUser?.role || null,
      isInvisible: !!(appUser?.isInvisible || appUser?.actualRole === 'super_admin'),
      action,
      details,
      timestamp:   serverTs(),
    };
    await db.collection('activityLog').add(doc);
  },
};

/* ── Firebase Auth REST API helpers (no session change) ──── */

export const AuthREST = {
  _apiKey() {
    return firebase.app().options.apiKey;
  },

  async createUser(email, password) {
    const key = this._apiKey();
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    });
    const data = await r.json();
    if (data.error) throw new Error(data.error.message);
    return { uid: data.localId, idToken: data.idToken, email: data.email };
  },

  async updateDisplayName(idToken, displayName) {
    const key = this._apiKey();
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:update?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, displayName, returnSecureToken: false }),
    });
    const data = await r.json();
    if (data.error) throw new Error(data.error.message);
    return data;
  },

  async deleteUser(idToken) {
    const key = this._apiKey();
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
    const data = await r.json();
    if (data.error) throw new Error(data.error.message);
  },
};
