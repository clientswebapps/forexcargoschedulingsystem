/**
 * firebase-config.js — Firebase configuration and initialization
 * Works across local dev servers (serve, live-server) and production hosting.
 */
'use strict';

const firebaseConfig = {
  apiKey: "AIzaSyB1OUgdOQz2gECrWPmAuTs0gJBIDn9_jgU",
  authDomain: "forex-cargo-scheduling-dev.firebaseapp.com",
  projectId: "forex-cargo-scheduling-dev",
  storageBucket: "forex-cargo-scheduling-dev.firebasestorage.app",
  messagingSenderId: "631113522661"
};

if (typeof firebase !== 'undefined' && !firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
