/**
 * pwa.js — Progressive Web App (PWA) Manager
 * Handles Service Worker registration, auto-update notification,
 * and Download / Install App prompts for Desktop, Android, and iOS.
 */
'use strict';
import { showToast, showModal, icons, escapeHtml } from './utils.js';

let deferredPrompt = null;
let updateRegistration = null;

/** Check if running in standalone installed mode */
export function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true ||
    document.referrer.includes('android-app://')
  );
}

/** Check if device is iOS */
export function isIOS() {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
}

/** Initialize PWA Service Worker & Install Listeners */
export function initPWA() {
  // 1. Register Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js');
        updateRegistration = reg;

        // Check for updates on register
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New update available in background
              showUpdateToast();
            }
          });
        });

        // Periodic update check every 30 minutes
        setInterval(() => {
          reg.update().catch(() => {});
        }, 30 * 60 * 1000);
      } catch (err) {
        console.warn('[PWA] Service worker registration failed:', err);
      }
    });

    // Reload when new service worker takes control
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  }

  // 2. Capture native browser install prompt (Android / Chrome / Edge)
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    updateDownloadAppButtons();
  });

  // 3. Track successful install
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    showToast('Forex Cargo App installed successfully!', 'success');
    updateDownloadAppButtons();
  });
}

/** Gentle update notification toast */
function showUpdateToast() {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast toast-info toast-visible';
  toast.style.cursor = 'pointer';
  toast.style.background = '#0D47A1';
  toast.innerHTML = `
    <span class="toast-icon">✨</span>
    <span class="toast-message" style="font-weight:500;">
      A new app update is ready. <strong>Click to update now</strong>
    </span>
    <button class="toast-close" aria-label="Dismiss">✕</button>
  `;

  toast.addEventListener('click', (e) => {
    if (e.target.classList.contains('toast-close')) {
      toast.remove();
      return;
    }
    if (updateRegistration && updateRegistration.waiting) {
      updateRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
    } else {
      window.location.reload();
    }
  });

  container.appendChild(toast);
}

/** Update the visibility and state of Download App buttons */
export function updateDownloadAppButtons() {
  const buttons = document.querySelectorAll('.download-app-btn');
  const standalone = isStandalone();

  buttons.forEach((btn) => {
    if (standalone) {
      btn.style.display = 'none';
    } else {
      btn.style.display = 'flex';
    }
  });
}

/** Prompt the user to install / download the app */
export async function promptInstallApp() {
  if (isStandalone()) {
    showToast('Forex Cargo is already installed on your device.', 'info');
    return;
  }

  // Case A: Browser supports native deferred prompt (Chrome, Edge, Android)
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      showToast('Installing Forex Cargo App…', 'info');
    }
    deferredPrompt = null;
    updateDownloadAppButtons();
    return;
  }

  // Case B: iOS Safari (Instructions popup)
  if (isIOS()) {
    showModal({
      title: 'Install Forex Cargo on iPhone / iPad',
      body: `
        <div style="text-align:center;padding:10px 0;">
          <div style="width:64px;height:64px;margin:0 auto 14px;background:#fff;border-radius:16px;padding:8px;box-shadow:var(--shadow-md);display:flex;align-items:center;justify-content:center;">
            <img src="/images/logo.png" alt="Forex Cargo" style="width:100%;height:100%;object-fit:contain;">
          </div>
          <div class="font-semibold text-base" style="margin-bottom:12px;">Add to Your Home Screen</div>
          <div style="text-align:left;background:var(--light-gray);border-radius:var(--radius-md);padding:14px 16px;font-size:0.85rem;line-height:1.6;">
            <div style="margin-bottom:8px;">
              <strong>Step 1:</strong> Tap the <strong>Share</strong> button at the bottom of Safari 
              <span style="display:inline-block;padding:2px 6px;background:#fff;border-radius:4px;border:1px solid #ccc;font-size:0.8rem;vertical-align:middle;margin-left:4px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
              </span>
            </div>
            <div>
              <strong>Step 2:</strong> Scroll down and tap <strong>Add to Home Screen ⊞</strong>.
            </div>
          </div>
        </div>
      `,
      confirmText: 'Got It',
      cancelText: null,
    });
    return;
  }

  // Case C: Desktop / Other browser without active prompt
  showModal({
    title: 'Install Forex Cargo App',
    body: `
      <div style="text-align:center;padding:10px 0;">
        <div style="width:64px;height:64px;margin:0 auto 14px;background:#fff;border-radius:16px;padding:8px;box-shadow:var(--shadow-md);display:flex;align-items:center;justify-content:center;">
          <img src="/images/logo.png" alt="Forex Cargo" style="width:100%;height:100%;object-fit:contain;">
        </div>
        <div class="font-semibold text-base" style="margin-bottom:12px;">Install on this Device</div>
        <p class="text-sm text-secondary" style="line-height:1.5;margin-bottom:14px;">
          You can install Forex Cargo directly to your desktop or mobile home screen for quick offline access and a dedicated standalone window.
        </p>
        <div style="background:var(--light-gray);border-radius:var(--radius-md);padding:12px 14px;font-size:0.8rem;text-align:left;">
          <strong>Tip:</strong> Look for the <strong>Install</strong> icon 
          <span style="display:inline-block;padding:2px 6px;background:#fff;border-radius:4px;border:1px solid #ccc;font-size:0.75rem;vertical-align:middle;margin:0 4px;">
            ⊕ Install
          </span> 
          in your browser's address bar at the top right.
        </div>
      </div>
    `,
    confirmText: 'Close',
    cancelText: null,
  });
}
