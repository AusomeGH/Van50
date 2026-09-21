/**
 * Van50 Android PWA Installation & Service Worker Controller
 * Manages native install prompts, standalone detection, and background caching.
 */

(function () {
  'use strict';

  let deferredPrompt = null;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  // 1. Register Service Worker for Offline Capabilities
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('sw.js')
        .then((reg) => {
          console.log('[PWA] ServiceWorker registered with scope:', reg.scope);

          // Check for service worker updates
          reg.addEventListener('updatefound', () => {
            const installingWorker = reg.installing;
            if (installingWorker) {
              installingWorker.addEventListener('statechange', () => {
                if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  console.log('[PWA] New version available! Refresh to update.');
                }
              });
            }
          });
        })
        .catch((err) => {
          console.warn('[PWA] ServiceWorker registration failed:', err);
        });
    });
  }

  // 2. If already running as an installed standalone app, skip install UI
  if (isStandalone) {
    console.log('[PWA] Van50 is running in standalone mode.');
    document.documentElement.classList.add('is-pwa-standalone');
    if (window.trackAnonymousEvent) {
      window.trackAnonymousEvent('app/standalone-open', 'Installed App Launch');
    }
    return;
  }

  // 3. UI Helpers: Inject Install Button & Toast Banner
  function createInstallUI() {
    // A. Header Action Button
    const navActions = document.querySelector('.nav-actions');
    if (navActions && !document.getElementById('pwa-header-install-btn')) {
      const headerBtn = document.createElement('button');
      headerBtn.id = 'pwa-header-install-btn';
      headerBtn.className = 'btn btn-pwa-install';
      headerBtn.setAttribute('aria-label', 'Install Van50 Android App');
      headerBtn.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 5px; vertical-align: -2px;">
          <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>
          <line x1="12" y1="18" x2="12.01" y2="18"></line>
        </svg>
        <span>Install App</span>
      `;
      headerBtn.addEventListener('click', triggerInstallFlow);
      navActions.insertBefore(headerBtn, navActions.firstChild);
    }

    // B. Mobile Bottom Banner
    if (!document.getElementById('pwa-mobile-banner')) {
      const banner = document.createElement('div');
      banner.id = 'pwa-mobile-banner';
      banner.className = 'pwa-install-banner';
      banner.innerHTML = `
        <div class="pwa-banner-content">
          <img src="icons/icon-192.png" alt="Van50 App Icon" class="pwa-banner-icon" width="40" height="40" />
          <div class="pwa-banner-text">
            <strong>Install Van50 on Android</strong>
            <span>Add to home screen for full-screen offline access</span>
          </div>
        </div>
        <div class="pwa-banner-actions">
          <button id="pwa-banner-install-btn" class="btn btn-pwa-banner">Install</button>
          <button id="pwa-banner-close-btn" class="btn-pwa-close" aria-label="Dismiss banner">✕</button>
        </div>
      `;

      document.body.appendChild(banner);

      document.getElementById('pwa-banner-install-btn')?.addEventListener('click', triggerInstallFlow);
      document.getElementById('pwa-banner-close-btn')?.addEventListener('click', () => {
        banner.classList.add('pwa-banner-hidden');
        sessionStorage.setItem('van50_pwa_dismissed', 'true');
      });

      // Show banner with smooth slide-up if not previously dismissed in session
      if (sessionStorage.getItem('van50_pwa_dismissed') !== 'true') {
        setTimeout(() => {
          banner.classList.add('pwa-banner-visible');
        }, 2000);
      }
    }
  }

  function hideInstallUI() {
    const headerBtn = document.getElementById('pwa-header-install-btn');
    if (headerBtn) headerBtn.style.display = 'none';

    const banner = document.getElementById('pwa-mobile-banner');
    if (banner) {
      banner.classList.remove('pwa-banner-visible');
      banner.classList.add('pwa-banner-hidden');
    }
  }

  // 4. Capture native browser beforeinstallprompt
  window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent default mini-infobar on mobile Chrome
    e.preventDefault();
    deferredPrompt = e;
    console.log('[PWA] Captured beforeinstallprompt event.');

    createInstallUI();
  });

  // 5. Trigger Native Install Flow
  async function triggerInstallFlow() {
    if (window.trackAnonymousEvent) {
      window.trackAnonymousEvent('pwa/install-prompt-click', 'Install App Prompt Click');
    }

    if (!deferredPrompt) {
      // Fallback instructions if prompt not directly available
      alert('To install Van50 on Android:\n1. Tap the Chrome menu (⋮) at top right\n2. Tap "Install App" or "Add to Home Screen"');
      return;
    }

    try {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`[PWA] User response to install prompt: ${outcome}`);
      deferredPrompt = null;
      if (outcome === 'accepted') {
        hideInstallUI();
      }
    } catch (err) {
      console.error('[PWA] Error launching install prompt:', err);
    }
  }

  // 6. Handle App Installed confirmation
  window.addEventListener('appinstalled', () => {
    console.log('[PWA] Van50 app installed successfully!');
    if (window.trackAnonymousEvent) {
      window.trackAnonymousEvent('pwa/installed-success', 'PWA App Installed');
    }
    hideInstallUI();
    deferredPrompt = null;
  });
})();
