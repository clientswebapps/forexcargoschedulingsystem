/**
 * login.js — Login page
 */
import { showToast, escapeHtml } from '../utils.js';
import { promptInstallApp, updateDownloadAppButtons } from '../pwa.js';

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

      <div style="margin-top:14px;">
        <button type="button" class="btn btn-secondary btn-sm download-app-btn" id="login-download-app-btn" style="display:inline-flex;align-items:center;gap:6px;width:100%;justify-content:center;font-weight:500;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Download / Install App
        </button>
      </div>

      <div class="login-footer">Internal staff access only &mdash; Forex Cargo Bahrain</div>
    </div>`;

  document.getElementById('login-download-app-btn')?.addEventListener('click', promptInstallApp);
  updateDownloadAppButtons();

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
