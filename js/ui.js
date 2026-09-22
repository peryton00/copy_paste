/**
 * LAN CLIPBOARD — UI Module
 * DOM helpers, toast notifications, modal management, and view switching.
 */

'use strict';

import { Utils } from './utils.js';

// ============================================================
// Toast System
// ============================================================

let _toastContainer = null;

function getToastContainer() {
  if (!_toastContainer) {
    _toastContainer = document.getElementById('toast-container');
  }
  return _toastContainer;
}

export const Toast = {
  /**
   * Show a toast notification.
   * @param {string} message
   * @param {'success'|'error'|'info'|'warning'} type
   * @param {number} duration ms (0 = persistent)
   */
  show(message, type = 'info', duration = 4000) {
    const container = getToastContainer();
    if (!container) return;

    const icons = {
      success: 'ph-check-circle',
      error:   'ph-warning-circle',
      info:    'ph-info',
      warning: 'ph-warning'
    };

    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'polite');
    toast.innerHTML = `
      <span class="toast-icon"><i class="${icons[type]} ph-fill" aria-hidden="true"></i></span>
      <span class="toast-message">${Utils.escapeHtml(message)}</span>
      <button class="toast-close" aria-label="Dismiss notification">
        <i class="ph-x" aria-hidden="true"></i>
      </button>
    `;

    const dismiss = () => {
      toast.classList.add('toast--exiting');
      toast.addEventListener('animationend', () => toast.remove(), { once: true });
      setTimeout(() => toast.remove(), 500);
    };

    toast.querySelector('.toast-close').addEventListener('click', dismiss);
    container.appendChild(toast);

    if (duration > 0) {
      setTimeout(dismiss, duration);
    }

    return { dismiss };
  },

  success(msg, duration)  { return this.show(msg, 'success', duration); },
  error(msg, duration)    { return this.show(msg, 'error',   duration); },
  info(msg, duration)     { return this.show(msg, 'info',    duration); },
  warning(msg, duration)  { return this.show(msg, 'warning', duration); }
};

// ============================================================
// Modal System
// ============================================================

const _activeModals = new Set();

export const Modal = {
  /**
   * Open a modal by its backdrop ID.
   */
  open(backdropId) {
    const backdrop = document.getElementById(backdropId);
    if (!backdrop) return;
    backdrop.classList.add('modal-backdrop--visible');
    backdrop.removeAttribute('aria-hidden');
    _activeModals.add(backdropId);

    // Focus first focusable element
    requestAnimationFrame(() => {
      const focusable = backdrop.querySelector(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]'
      );
      if (focusable) focusable.focus();
    });

    // Close on backdrop click (bind once per backdrop)
    if (!backdrop._hasBackdropListener) {
      backdrop.addEventListener('click', e => {
        if (e.target === backdrop) this.close(backdropId);
      });
      backdrop._hasBackdropListener = true;
    }
  },

  /**
   * Close a modal by its backdrop ID.
   */
  close(backdropId) {
    const backdrop = document.getElementById(backdropId);
    if (!backdrop) return;
    backdrop.classList.remove('modal-backdrop--visible');
    backdrop.setAttribute('aria-hidden', 'true');
    _activeModals.delete(backdropId);
  },

  /**
   * Close all open modals.
   */
  closeAll() {
    _activeModals.forEach(id => this.close(id));
  },

  /**
   * Check if a modal is open.
   */
  isOpen(backdropId) {
    return _activeModals.has(backdropId);
  }
};

// ============================================================
// View Router
// ============================================================

export const Router = {
  _current: null,
  _handlers: {},

  /**
   * Navigate to a view by name.
   */
  navigate(viewName, data = {}) {
    // Hide all views
    document.querySelectorAll('.view').forEach(el => el.classList.remove('view--active'));

    // Show target view
    const target = document.getElementById(`view-${viewName}`);
    if (target) {
      target.classList.add('view--active');
    }

    // Update nav highlights
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('nav-item--active', el.dataset.view === viewName);
    });
    document.querySelectorAll('.mobile-nav-item').forEach(el => {
      el.classList.toggle('mobile-nav-item--active', el.dataset.view === viewName);
    });

    // Update topbar title
    const titleEl = document.getElementById('topbar-title');
    if (titleEl) {
      const titles = {
        dashboard: 'Dashboard',
        devices:   'Devices',
        history:   'Clipboard History',
        pair:      'Pair Device',
        settings:  'Settings',
        about:     'About & Privacy'
      };
      titleEl.textContent = titles[viewName] || 'LAN Clipboard';
    }

    const prev = this._current;
    this._current = viewName;

    // Call handler if registered
    if (this._handlers[viewName]) {
      this._handlers[viewName](data, prev);
    }
  },

  /**
   * Register a view activation handler.
   */
  on(viewName, handler) {
    this._handlers[viewName] = handler;
  },

  current() {
    return this._current;
  }
};

// ============================================================
// Status Dot
// ============================================================

export function renderStatusDot(status) {
  return `<span class="status-dot status-dot--${status}" aria-hidden="true"></span>`;
}

export function renderStatusBadge(status) {
  const label = Utils.getStatusLabel(status);
  return `<span class="status-badge status-badge--${status}">${renderStatusDot(status)}${Utils.escapeHtml(label)}</span>`;
}

// ============================================================
// Device Icon
// ============================================================

export function renderDeviceIcon(type) {
  const icon = Utils.getDeviceTypeIcon(type);
  return `<i class="${icon}" aria-hidden="true"></i>`;
}

// ============================================================
// Compatibility Check
// ============================================================

export const Compat = {
  check() {
    return {
      webRTC:      typeof RTCPeerConnection !== 'undefined',
      clipboard:   !!(navigator.clipboard),
      indexedDB:   typeof indexedDB !== 'undefined',
      webCrypto:   !!(window.crypto && window.crypto.getRandomValues),
      serviceWorker: 'serviceWorker' in navigator,
      secureContext: window.isSecureContext,
      camera:      !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
    };
  },

  allCritical(results) {
    return results.webCrypto && results.indexedDB;
  },

  render(results) {
    const items = [
      { key: 'webRTC',       label: 'WebRTC (Peer-to-peer)',      critical: true },
      { key: 'clipboard',    label: 'Clipboard API',              critical: true },
      { key: 'webCrypto',    label: 'Web Crypto API',             critical: true },
      { key: 'indexedDB',    label: 'IndexedDB (Local storage)',  critical: true },
      { key: 'secureContext',label: 'Secure Context (HTTPS/localhost)', critical: false },
      { key: 'serviceWorker',label: 'Service Worker (PWA)',       critical: false },
      { key: 'camera',       label: 'Camera (QR scanning)',       critical: false }
    ];

    return items.map(item => {
      const ok      = results[item.key];
      const iconCls = ok ? 'compat-icon--ok' : (item.critical ? 'compat-icon--warn' : 'compat-icon--partial');
      const icon    = ok ? 'ph-check' : (item.critical ? 'ph-x' : 'ph-warning');
      const status  = ok ? 'Available' : (item.critical ? 'Not available' : 'Unavailable');

      return `
        <div class="compat-item">
          <div class="compat-icon ${iconCls}"><i class="${icon}" aria-hidden="true"></i></div>
          <span class="compat-label">${Utils.escapeHtml(item.label)}</span>
          <span class="compat-status">${status}</span>
        </div>
      `;
    }).join('');
  }
};

// ============================================================
// Countdown Timer
// ============================================================

export class CountdownTimer {
  constructor(el, totalSeconds, onExpire) {
    this.el           = el;
    this.totalSeconds = totalSeconds;
    this.remaining    = totalSeconds;
    this.onExpire     = onExpire;
    this._interval    = null;
  }

  start() {
    this._render();
    this._interval = setInterval(() => {
      this.remaining--;
      this._render();
      if (this.remaining <= 0) {
        this.stop();
        if (this.onExpire) this.onExpire();
      }
    }, 1000);
    return this;
  }

  stop() {
    clearInterval(this._interval);
    this._interval = null;
  }

  reset(totalSeconds) {
    this.stop();
    this.totalSeconds = totalSeconds;
    this.remaining    = totalSeconds;
  }

  _render() {
    if (!this.el) return;
    const m = Math.floor(this.remaining / 60).toString().padStart(2, '0');
    const s = (this.remaining % 60).toString().padStart(2, '0');
    this.el.textContent = `${m}:${s}`;
  }
}

// ============================================================
// DOM helpers
// ============================================================

export const $ = (selector, parent = document) => parent.querySelector(selector);
export const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

export function createElement(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'className') el.className = v;
    else if (k === 'textContent') el.textContent = v;
    else if (k === 'innerHTML') el.innerHTML = v;
    else el.setAttribute(k, v);
  });
  children.forEach(child => {
    if (typeof child === 'string') el.appendChild(document.createTextNode(child));
    else if (child) el.appendChild(child);
  });
  return el;
}

/**
 * Format direction label for history items
 */
export function directionLabel(dir) {
  const map = {
    sent:     { cls: 'badge-sent',     icon: 'ph-arrow-up-right',   text: 'Sent' },
    received: { cls: 'badge-received', icon: 'ph-arrow-down-left',  text: 'Received' },
    local:    { cls: 'badge-local',    icon: 'ph-clipboard',         text: 'Local' }
  };
  const d = map[dir] || map.local;
  return `<span class="history-direction-badge ${d.cls}">
    <span class="badge-icon"><i class="${d.icon}" aria-hidden="true"></i></span>${d.text}
  </span>`;
}
