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

/* ── Helpers ─────────────────────────────────────────────── */

const serverTs = () => firebase.firestore.FieldValue.serverTimestamp();
const currentUid = () => auth.currentUser && auth.currentUser.uid;

function docData(snap) {
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

function collData(snap) {
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* ── USERS ───────────────────────────────────────────────── */

export const Users = {
  col: () => db.collection('users'),
  doc: (uid) => db.collection('users').doc(uid),

  async get(uid) {
    return docData(await db.collection('users').doc(uid).get());
  },

  async getAll() {
    const snap = await db.collection('users').orderBy('displayName').get();
    return collData(snap);
  },

  async getByRole(role) {
    const snap = await db.collection('users').where('role', '==', role).orderBy('displayName').get();
    return collData(snap);
  },

  async getActiveSalespersons() {
    const snap = await db.collection('users')
      .where('role', '==', 'salesperson')
      .get();
    return collData(snap)
      .filter(u => u.isActive !== false)
      .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
  },

  async getActiveStaff() {
    const snap = await db.collection('users').get();
    return collData(snap)
      .filter(u => u.isActive !== false)
      .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
  },

  async create(uid, data) {
    const doc = {
      displayName: data.displayName,
      email:       data.email,
      role:        data.role,
      isActive:    true,
      createdAt:   serverTs(),
      updatedAt:   serverTs(),
    };
    await db.collection('users').doc(uid).set(doc);
    return { id: uid, ...doc };
  },

  async update(uid, data) {
    const updates = { ...data, updatedAt: serverTs() };
    await db.collection('users').doc(uid).update(updates);
  },

  onSnapshot(callback) {
    return db.collection('users').orderBy('displayName').onSnapshot(snap => callback(collData(snap)));
  },
};

/* ── CUSTOMERS ───────────────────────────────────────────── */

export const Customers = {
  col: () => db.collection('customers'),

  async get(id) {
    return docData(await db.collection('customers').doc(id).get());
  },

  async getAll() {
    const snap = await db.collection('customers').orderBy('name').get();
    return collData(snap);
  },

  /** Search by contact number (normalizes digits and country codes) */
  async searchByPhone(phone) {
    if (!phone) return [];
    const cleanSearch = phone.replace(/\D/g, '');
    if (!cleanSearch) return [];

    let searchLocal = cleanSearch;
    if (cleanSearch.startsWith('973') && cleanSearch.length > 3) {
      searchLocal = cleanSearch.substring(3);
    }

    const all = await this.getAll();
    return all.filter(c => {
      if (!c.contactNumber) return false;
      const cleanCust = c.contactNumber.replace(/\D/g, '');
      let custLocal = cleanCust;
      if (cleanCust.startsWith('973') && cleanCust.length > 3) {
        custLocal = cleanCust.substring(3);
      }
      return custLocal.includes(searchLocal) || searchLocal.includes(custLocal);
    }).slice(0, 8);
  },

  /** Search by name prefix */
  async searchByName(name) {
    if (!name) return [];
    const end = name + '\uf8ff';
    const snap = await db.collection('customers')
      .where('nameLower', '>=', name.toLowerCase())
      .where('nameLower', '<=', name.toLowerCase() + '\uf8ff')
      .limit(8)
      .get();
    return collData(snap);
  },

  async create(data) {
    const doc = {
      name:          data.name,
      nameLower:     data.name.toLowerCase(),
      contactNumber: data.contactNumber,
      address:       data.address || '',
      createdBy:     currentUid(),
      createdAt:     serverTs(),
      updatedAt:     serverTs(),
    };
    const ref = await db.collection('customers').add(doc);
    return { id: ref.id, ...doc };
  },

  async update(id, data) {
    const updates = {
      name:          data.name,
      nameLower:     data.name.toLowerCase(),
      contactNumber: data.contactNumber,
      address:       data.address || '',
      updatedAt:     serverTs(),
    };
    await db.collection('customers').doc(id).update(updates);
  },

  onSnapshot(callback) {
    return db.collection('customers').orderBy('name').onSnapshot(snap => callback(collData(snap)));
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
  buildQuery(filters = {}) {
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

    return q.orderBy('scheduledDate', 'desc');
  },

  /** Get all bookings (Admin/Office) with optional filters (one-time fetch) */
  async getAll(filters = {}) {
    const snap = await this.buildQuery(filters).get();
    return collData(snap);
  },

  /** Real-time listener for all schedules (Admin/Office) with optional filters */
  onAllSnapshot(filters = {}, callback, errorCallback) {
    const q = this.buildQuery(filters);
    return q.onSnapshot(
      snap => callback(collData(snap)),
      err => {
        console.error('Real-time schedules listener error:', err);
        if (errorCallback) errorCallback(err);
      }
    );
  },

  /** Build query for a specific salesperson's schedules */
  buildMineQuery(salespersonId, filters = {}) {
    let q = db.collection('bookings').where('salespersonId', '==', salespersonId);

    if (filters.status) q = q.where('status', '==', filters.status);
    if (filters.scheduledPeriod) q = q.where('scheduledPeriod', '==', filters.scheduledPeriod);

    if (filters.dateFrom) {
      q = q.where('scheduledDate', '>=', parseLocalDate(filters.dateFrom, false));
    }
    if (filters.dateTo) {
      q = q.where('scheduledDate', '<=', parseLocalDate(filters.dateTo, true));
    }

    return q.orderBy('scheduledDate', 'desc');
  },

  /** Get bookings for a specific salesperson (their schedule) (one-time fetch) */
  async getMine(salespersonId, filters = {}) {
    const snap = await this.buildMineQuery(salespersonId, filters).get();
    return collData(snap);
  },

  /** Real-time listener for a salesperson's schedules */
  onMineSnapshot(salespersonId, filters = {}, callback, errorCallback) {
    const q = this.buildMineQuery(salespersonId, filters);
    return q.onSnapshot(
      snap => callback(collData(snap)),
      err => {
        console.error('Real-time my-schedule listener error:', err);
        if (errorCallback) errorCallback(err);
      }
    );
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
      status:          'Pending',
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

  /** Salesperson: update only completion notes and status */
  async updateSalesperson(id, { completionNotes, status }) {
    await db.collection('bookings').doc(id).update({
      completionNotes,
      status,
      updatedAt:   serverTs(),
      updatedById: currentUid(),
    });
  },

  /** Quick status update with validation */
  async updateStatus(id, newStatus) {
    await db.collection('bookings').doc(id).update({
      status:      newStatus,
      updatedAt:   serverTs(),
      updatedById: currentUid(),
    });
  },

  /** Delete a schedule record */
  async delete(id) {
    await db.collection('bookings').doc(id).delete();
  },

  onSnapshot(id, callback) {
    return db.collection('bookings').doc(id).onSnapshot(snap => callback(docData(snap)));
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

  onSnapshot(uid, callback) {
    return db.collection('notifications')
      .where('recipientId', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .onSnapshot(snap => callback(collData(snap)));
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
    const doc = {
      bookingId:  bookingId || null,
      actorId:    user ? user.uid : null,
      actorName:  user ? (user.displayName || user.email) : 'System',
      action,
      details,
      timestamp:  serverTs(),
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
