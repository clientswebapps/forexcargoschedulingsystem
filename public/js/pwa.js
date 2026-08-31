/**
 * pwa.js — Progressive Web App (PWA) Manager
 * Handles Service Worker registration, auto-update notification,
 * and Download / Install App prompts for Desktop, Android, iOS, and Tablets.
 */
'use strict';
import { showToast, showModal, icons, escapeHtml } from './utils.js';

let deferredPrompt = null;
let isPWAInitialized = false;

/** Check if running in standalone installed mode */
export function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true ||
    document.referrer.includes('android-app://')
  );
}

/** Check if device is iOS or iPadOS */
export function isIOS() {
  const ua = navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

/** Check if device is Android */
export function isAndroid() {
  return /Android/i.test(navigator.userAgent);
}

/** Initialize PWA Service Worker & Install Listeners */
export function initPWA() {
  if (isPWAInitialized) {
    updateDownloadAppButtons();
    return;
  }
  isPWAInitialized = true;

  // 1. Register Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js');

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
    showToast('Forex Cargo App is installed!', 'success');
    updateDownloadAppButtons();
  });
}

/** Direct trigger for browser install prompt */
async function triggerDirectInstall() {
  if (deferredPrompt) {
    try {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        showToast('Installing Forex Cargo App…', 'info');
      }
      deferredPrompt = null;
      updateDownloadAppButtons();
    } catch (err) {
      console.warn('[PWA] prompt error:', err);
    }
  }
}

/** Update the visibility and state of Download App buttons */
export function updateDownloadAppButtons() {
  const buttons = document.querySelectorAll('.download-app-btn');
  const standalone = isStandalone();

  buttons.forEach((btn) => {
    if (standalone) {
      btn.style.display = 'none';
    } else {
      btn.style.display = 'inline-flex';
    }
  });
}

/** Prompt the user to install / download the app */
export async function promptInstallApp() {
  if (isStandalone()) {
    showToast('Forex Cargo App is already installed.', 'info');
    return;
  }

  // Case A: Browser has active native deferred prompt (Chrome, Edge, Android)
  if (deferredPrompt) {
    triggerDirectInstall();
    return;
  }

  // Case B: iOS / iPadOS Safari (Step-by-step Visual Guide)
  if (isIOS()) {
    showModal({
      title: 'Install on iPhone / iPad',
      body: `
        <div style="text-align:center;padding:8px 0;">
          <div style="width:64px;height:64px;margin:0 auto 12px;background:#fff;border-radius:16px;padding:8px;box-shadow:var(--shadow-md);display:flex;align-items:center;justify-content:center;">
            <img src="/images/logo.png" alt="Forex Cargo" style="width:100%;height:100%;object-fit:contain;">
          </div>
          <div class="font-semibold text-base" style="margin-bottom:12px;color:var(--navy);">Add Forex Cargo to Home Screen</div>
          <div style="text-align:left;background:var(--light-gray);border-radius:var(--radius-md);padding:14px 16px;font-size:0.85rem;line-height:1.6;">
            <div style="margin-bottom:10px;display:flex;align-items:center;gap:8px;">
              <span style="font-weight:700;background:var(--navy);color:#fff;border-radius:50%;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;font-size:0.75rem;flex-shrink:0;">1</span>
              <span>Tap the <strong>Share</strong> button in Safari's toolbar:
                <span style="display:inline-block;padding:2px 6px;background:#fff;border-radius:4px;border:1px solid #ccc;font-size:0.8rem;vertical-align:middle;margin-left:4px;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                </span>
              </span>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="font-weight:700;background:var(--navy);color:#fff;border-radius:50%;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;font-size:0.75rem;flex-shrink:0;">2</span>
              <span>Scroll down and tap <strong>Add to Home Screen ⊞</strong>.</span>
            </div>
          </div>
        </div>
      `,
      confirmText: 'Got It',
      cancelText: null,
    });
    return;
  }

  // Case C: Android / Mobile Tablet (Chrome / Samsung Internet / Other)
  if (isAndroid()) {
    showModal({
      title: 'Install on Android / Tablet',
      body: `
        <div style="text-align:center;padding:8px 0;">
          <div style="width:64px;height:64px;margin:0 auto 12px;background:#fff;border-radius:16px;padding:8px;box-shadow:var(--shadow-md);display:flex;align-items:center;justify-content:center;">
            <img src="/images/logo.png" alt="Forex Cargo" style="width:100%;height:100%;object-fit:contain;">
          </div>
          <div class="font-semibold text-base" style="margin-bottom:12px;color:var(--navy);">Install Forex Cargo App</div>
          <div style="text-align:left;background:var(--light-gray);border-radius:var(--radius-md);padding:14px 16px;font-size:0.85rem;line-height:1.6;">
            <div style="margin-bottom:10px;display:flex;align-items:center;gap:8px;">
              <span style="font-weight:700;background:var(--navy);color:#fff;border-radius:50%;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;font-size:0.75rem;flex-shrink:0;">1</span>
              <span>Tap the <strong>Menu (⋮)</strong> button at the top-right of Chrome/browser.</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="font-weight:700;background:var(--navy);color:#fff;border-radius:50%;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;font-size:0.75rem;flex-shrink:0;">2</span>
              <span>Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.</span>
            </div>
          </div>
        </div>
      `,
      confirmText: 'Got It',
      cancelText: null,
    });
    return;
  }

  // Case D: Desktop / PC / Laptop
  showModal({
    title: 'Install Forex Cargo App',
    body: `
      <div style="text-align:center;padding:8px 0;">
        <div style="width:64px;height:64px;margin:0 auto 12px;background:#fff;border-radius:16px;padding:8px;box-shadow:var(--shadow-md);display:flex;align-items:center;justify-content:center;">
          <img src="/images/logo.png" alt="Forex Cargo" style="width:100%;height:100%;object-fit:contain;">
        </div>
        <div class="font-semibold text-base" style="margin-bottom:8px;color:var(--navy);">Install on this Computer</div>
        <p class="text-sm text-secondary" style="line-height:1.5;margin-bottom:14px;">
          Install Forex Cargo as a standalone desktop app for fast launching, notifications, and offline access.
        </p>
        <div style="background:var(--light-gray);border-radius:var(--radius-md);padding:12px 14px;font-size:0.82rem;text-align:left;">
          <strong>Tip:</strong> Look for the <strong>Install</strong> icon 
          <span style="display:inline-block;padding:2px 6px;background:#fff;border-radius:4px;border:1px solid #ccc;font-size:0.75rem;vertical-align:middle;margin:0 4px;font-weight:600;">
            ⊕ Install
          </span> 
          in your browser's address bar at the top right.
        </div>
      </div>
    `,
    confirmText: 'Got It',
    cancelText: null,
  });
}
