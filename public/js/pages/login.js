/**
 * login.js — Login page
 */
'use strict';
import { showToast, escapeHtml } from '../utils.js';

export function renderLogin(container, initialError) {
  container.innerHTML = `
    <div class="login-card">
      <div class="login-brand">
        <div class="login-logo">
          <img src="/images/logo.png" alt="Forex Cargo Logo" style="width:100%;height:100%;object-fit:contain;">
        </div>
        <div class="login-title">Forex Cargo</div>
        <div class="login-subtitle">Scheduling &amp; Operations System</div>
      </div>

      <div id="login-error" class="login-error${initialError ? '' : ' hidden'}">${initialError ? escapeHtml(initialError) : ''}</div>

      <form id="login-form" novalidate>
        <div class="form-group">
          <label class="form-label required" for="login-email">Email Address</label>
          <input type="email" id="login-email" class="form-control" placeholder="you@forexcargo.bh"
            autocomplete="email" required>
        </div>
        <div class="form-group">
          <label class="form-label required" for="login-password">Password</label>
          <input type="password" id="login-password" class="form-control" placeholder="••••••••"
            autocomplete="current-password" required>
        </div>
        <button type="submit" class="btn btn-navy w-full btn-lg" id="login-btn" style="margin-top:8px;">
          Sign In
        </button>
      </form>

      <div class="login-footer">Internal staff access only &mdash; Forex Cargo Bahrain</div>
    </div>`;

  const form      = document.getElementById('login-form');
  const emailEl   = document.getElementById('login-email');
  const passEl    = document.getElementById('login-password');
  const btn       = document.getElementById('login-btn');
  const errorBox  = document.getElementById('login-error');

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.classList.remove('hidden');
  }
  function clearError() { errorBox.classList.add('hidden'); }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    clearError();
    const email    = emailEl.value.trim();
    const password = passEl.value;
    if (!email || !password) { showError('Please enter your email and password.'); return; }

    btn.disabled = true;
    btn.textContent = 'Signing in…';

    try {
      await firebase.auth().signInWithEmailAndPassword(email, password);
      // Auth state change in app.js takes over
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Sign In';
      const msgs = {
        'auth/user-not-found':     'No account found with this email.',
        'auth/wrong-password':     'Incorrect password. Please try again.',
        'auth/invalid-email':      'Please enter a valid email address.',
        'auth/user-disabled':      'This account has been disabled. Contact your administrator.',
        'auth/too-many-requests':  'Too many failed attempts. Please wait and try again.',
        'auth/invalid-credential': 'Invalid email or password.',
      };
      showError(msgs[err.code] || 'Sign-in failed. Please try again.');
    }
  });

  // Focus email on load
  emailEl.focus();
}
