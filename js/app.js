/**
 * LAN CLIPBOARD — Main Application
 * Orchestrates all modules: device identity, pairing, WebRTC,
 * clipboard, history, settings, and UI.
 */

'use strict';

import { Security }                      from './security.js';
import { Storage }                       from './storage.js';
import { Settings }                      from './settings.js';
import { Devices }                       from './devices.js';
import { History, Direction }            from './history.js';
import { Clipboard }                     from './clipboard.js';
import { Protocol, MessageType }         from './protocol.js';
import { ConnectionManager,
         ConnectionStatus }              from './webrtc.js';
import { PairingManager, PairingStatus } from './pairing.js';
import { QR }                            from './qr.js';
import { Utils }                         from './utils.js';
import {
  Toast, Modal, Router, Compat,
  renderStatusDot, renderStatusBadge,
  renderDeviceIcon, directionLabel,
  CountdownTimer, $, $$
}                                        from './ui.js';

// ============================================================
// Application State
// ============================================================

const appState = {
  device:            null,     // Local device identity
  settings:          {},       // User settings
  trustedDevices:    [],       // Array of trusted device records
  connectionStatuses:{},       // deviceId -> ConnectionStatus string
  clipboard:         '',       // Current clipboard text in editor
  history:           [],       // Array of history items
  incomingItems:     [],       // Pending incoming clipboard items (shown in dashboard)
  pairing: {
    session:         null,
    offerPayload:    null,
    qrTimer:         null,
    countdownTimer:  null,
    mode:            'generate',  // 'generate' | 'enter'
    activeTab:       'qr'         // 'qr' | 'code'
  },
  selectedDeviceId:  null,     // Device selected for sending
  ui: {
    sidebarOpen:     false,
    currentView:     'dashboard'
  }
};

// ============================================================
// Managers
// ============================================================

const connManager = new ConnectionManager();
let pairingManager = null;

// ============================================================
// Bootstrap
// ============================================================

async function bootstrap() {
  // Check critical compatibility
  const compat = Compat.check();
  showCompatWarnings(compat);

  // Load settings
  appState.settings = await Settings.load();

  // Check first run
  const savedDevice = await Settings.get('localDevice');

  if (!savedDevice || !savedDevice.deviceId) {
    showFirstRun();
    return;
  }

  // Returning user: hide first run screen and display app
  document.getElementById('first-run-screen')?.setAttribute('hidden', '');
  document.getElementById('app-shell')?.removeAttribute('hidden');

  appState.device = savedDevice;
  await initApp();
}

function showFirstRun() {
  document.getElementById('first-run-screen').removeAttribute('hidden');
  document.getElementById('app-shell').setAttribute('hidden', '');

  const nameInput = document.getElementById('first-run-name');
  const continueBtn = document.getElementById('first-run-continue');
  const detectedType = Utils.detectDeviceType();

  // Pre-fill with a friendly default
  const defaults = { mobile: 'My Phone', tablet: 'My Tablet', desktop: 'My Computer' };
  nameInput.value = defaults[detectedType] || 'My Device';

  continueBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.classList.add('input-field--error');
      nameInput.focus();
      return;
    }
    nameInput.classList.remove('input-field--error');
    continueBtn.classList.add('btn--loading');
    continueBtn.disabled = true;

    const device = Devices.createLocalDevice(name);
    await Settings.set('localDevice', device);
    appState.device = device;

    document.getElementById('first-run-screen').setAttribute('hidden', '');
    document.getElementById('app-shell').removeAttribute('hidden');

    await initApp();
  });

  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') continueBtn.click();
  });
}

async function initApp() {
  // Ensure screen visibility
  document.getElementById('first-run-screen')?.setAttribute('hidden', '');
  document.getElementById('app-shell')?.removeAttribute('hidden');

  // Init connection manager
  connManager.init({
    localDeviceId:  appState.device.deviceId,
    onMessage:      handlePeerMessage,
    onStatusChange: handleStatusChange,
    onError:        handleConnectionError
  });

  // Init pairing manager
  pairingManager = new PairingManager({
    device:             appState.device,
    connectionManager:  connManager,
    onPairingComplete:  onPairingComplete,
    onPairingRequest:   onPairingRequest,
    onPairingError:     err => Toast.error(err)
  });

  // Load persisted data
  appState.trustedDevices = await Devices.getAll();
  appState.history        = await History.getAll();

  // Render UI
  renderSidebarDevice();
  renderDevicesView();
  renderHistoryView();
  await renderSettingsView();
  renderDashboardDevices();
  updateNetworkStatus();

  // Set up all event listeners
  setupNavigation();
  setupSidebar();
  setupClipboardPanel();
  setupPairingModal();
  setupPairingEnterFlow();
  setupSettingsHandlers();
  setupGlobalKeyboard();

  // Start on dashboard
  Router.navigate('dashboard');

  // Register Service Worker
  registerServiceWorker();

  // Periodic status refresh
  setInterval(updateConnectionStatuses, 5000);
}

// ============================================================
// Compatibility Warnings
// ============================================================

function showCompatWarnings(compat) {
  const warnings = [];

  if (!compat.webCrypto) {
    warnings.push('Web Crypto API is not available. Secure pairing is disabled.');
  }
  if (!compat.indexedDB) {
    warnings.push('IndexedDB is not available. History will not be saved.');
  }
  if (!compat.webRTC) {
    warnings.push('WebRTC is not available in this browser. Peer-to-peer transfers will not work.');
  }
  if (!compat.secureContext) {
    warnings.push('Not running in a secure context (HTTPS/localhost). Clipboard access may be restricted.');
  }

  const container = document.getElementById('compat-warnings');
  if (warnings.length && container) {
    container.innerHTML = warnings.map(w => `
      <div class="banner banner--warning" role="alert">
        <span class="banner-icon"><i class="ph-warning" aria-hidden="true"></i></span>
        <span class="banner-text">${Utils.escapeHtml(w)}</span>
      </div>
    `).join('');
    container.removeAttribute('hidden');
  }

  // Also populate compat modal
  const compatList = document.getElementById('compat-list');
  if (compatList) {
    compatList.innerHTML = Compat.render(compat);
  }
}

// ============================================================
// Navigation
// ============================================================

function setupNavigation() {
  // Sidebar nav items
  document.querySelectorAll('.nav-item[data-view]').forEach(el => {
    el.addEventListener('click', () => {
      if (el.hasAttribute('data-open-pairing')) return; // handled by pairing setup
      Router.navigate(el.dataset.view);
      if (window.innerWidth <= 768) closeSidebar();
    });
  });

  // Mobile nav items
  document.querySelectorAll('.mobile-nav-item[data-view]').forEach(el => {
    el.addEventListener('click', () => {
      if (el.hasAttribute('data-open-pairing')) return;
      Router.navigate(el.dataset.view);
    });
  });

  // Topbar settings button
  document.querySelectorAll('.topbar-right [data-view]').forEach(el => {
    el.addEventListener('click', () => Router.navigate(el.dataset.view));
  });

  // Any non-nav element with data-view attribute
  document.querySelectorAll('[data-view]').forEach(el => {
    if (el.classList.contains('nav-item') || el.classList.contains('mobile-nav-item')) return;
    if (el.hasAttribute('data-open-pairing')) return;
    el.addEventListener('click', () => Router.navigate(el.dataset.view));
  });

  // View handlers
  Router.on('dashboard', () => {
    renderDashboardDevices();
    renderIncomingPanel();
  });

  Router.on('devices', () => {
    renderDevicesView();
  });

  Router.on('history', () => {
    loadAndRenderHistory();
  });

  Router.on('pair', () => {
    // Don't auto-open modal; the pair view has its own buttons
  });

  Router.on('settings', () => {
    renderSettingsView();
  });

  Router.on('about', () => {});
}

// ============================================================
// Sidebar
// ============================================================

function setupSidebar() {
  const overlay = document.getElementById('sidebar-overlay');
  const toggle  = document.getElementById('sidebar-toggle');

  if (toggle) {
    toggle.addEventListener('click', () => {
      if (appState.ui.sidebarOpen) closeSidebar();
      else openSidebar();
    });
  }

  if (overlay) {
    overlay.addEventListener('click', closeSidebar);
  }
}

function openSidebar() {
  document.getElementById('sidebar').classList.add('sidebar--open');
  document.getElementById('sidebar-overlay').classList.add('sidebar-overlay--visible');
  appState.ui.sidebarOpen = true;
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('sidebar--open');
  document.getElementById('sidebar-overlay').classList.remove('sidebar-overlay--visible');
  appState.ui.sidebarOpen = false;
}

// ============================================================
// Sidebar device info
// ============================================================

function renderSidebarDevice() {
  if (!appState.device) return;

  const nameEl = document.getElementById('sidebar-device-name');
  const iconEl = document.getElementById('sidebar-device-icon');
  const typeEl = document.getElementById('sidebar-device-type');

  if (nameEl) nameEl.textContent = appState.device.deviceName;
  if (typeEl) typeEl.textContent = Utils.getStatusLabel('offline');
  if (iconEl) iconEl.innerHTML   = renderDeviceIcon(appState.device.deviceType);

  // Topbar
  const topbarDeviceName = document.getElementById('topbar-device-name');
  if (topbarDeviceName) topbarDeviceName.textContent = appState.device.deviceName;
}

// ============================================================
// Network status
// ============================================================

function updateNetworkStatus() {
  const connCount = connManager.getAllConnections()
    .filter(c => c.status === ConnectionStatus.CONNECTED).length;

  const statusEl = document.getElementById('network-status-text');
  const countEl  = document.getElementById('connected-count');

  if (statusEl) {
    statusEl.textContent = connCount > 0
      ? `${connCount} device${connCount !== 1 ? 's' : ''} connected`
      : 'No connections';
  }

  if (countEl) {
    countEl.textContent = connCount.toString();
  }

  const dot = document.getElementById('network-status-dot');
  if (dot) {
    dot.className = `status-dot ${connCount > 0 ? 'status-dot--connected' : 'status-dot--offline'}`;
  }
}

// ============================================================
// Clipboard Panel
// ============================================================

function setupClipboardPanel() {
  const readBtn      = document.getElementById('read-clipboard-btn');
  const textarea     = document.getElementById('clipboard-textarea');
  const clearBtn     = document.getElementById('clipboard-clear-btn');
  const sendBtn      = document.getElementById('send-clipboard-btn');
  const charCount    = document.getElementById('char-count');
  const confirmPanel = document.getElementById('send-confirm-panel');

  if (readBtn) {
    readBtn.addEventListener('click', async () => {
      readBtn.disabled = true;

      const result = await Clipboard.read();
      readBtn.disabled = false;

      if (!result.ok) {
        Toast.error(result.error);
        return;
      }

      if (!result.text) {
        Toast.info('Clipboard is empty.');
        return;
      }

      textarea.value = result.text;
      updateCharCount();
      appState.clipboard = result.text;

      // Add to local history
      if (appState.settings.historyEnabled) {
        const item = await History.add({ text: result.text, direction: Direction.LOCAL });
        if (item) {
          appState.history.unshift(item);
          updateHistoryBadge();
        }
      }

      Toast.success('Clipboard content loaded.');
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      textarea.value = '';
      appState.clipboard = '';
      updateCharCount();
    });
  }

  if (textarea) {
    textarea.addEventListener('input', () => {
      appState.clipboard = textarea.value;
      updateCharCount();
    });
  }

  if (sendBtn) {
    sendBtn.addEventListener('click', async () => {
      const text = textarea.value.trim();

      if (!text) {
        Toast.warning('Please enter or read clipboard content first.');
        textarea.focus();
        return;
      }

      // Size check
      const maxBytes = await Settings.getMaxClipboardBytes();
      const sizeCheck = Clipboard.validateSize(text, maxBytes);
      if (!sizeCheck.ok) {
        Toast.error(sizeCheck.error);
        return;
      }

      if (!appState.selectedDeviceId) {
        Toast.warning('Please select a device to send to.');
        return;
      }

      const conn = connManager.getConnection(appState.selectedDeviceId);
      if (!conn || !conn.isReady) {
        Toast.error('The selected device is not connected. Please reconnect first.');
        return;
      }

      const requireConfirm = appState.settings.requireSendConfirm;
      const targetDevice = appState.trustedDevices.find(d => d.deviceId === appState.selectedDeviceId);
      const targetName = targetDevice?.deviceName || 'Unknown Device';

      if (requireConfirm && confirmPanel) {
        // Show confirmation panel
        document.getElementById('confirm-device-name').textContent = targetName;
        confirmPanel.classList.remove('hidden');
        confirmPanel.removeAttribute('hidden');
        return;
      }

      await doSend(text, appState.selectedDeviceId, targetName);
    });
  }

  // Confirm send actions
  const confirmYes = document.getElementById('confirm-send-yes');
  const confirmNo  = document.getElementById('confirm-send-no');

  if (confirmYes) {
    confirmYes.addEventListener('click', async () => {
      confirmPanel.setAttribute('hidden', '');
      const text = textarea.value.trim();
      const targetDevice = appState.trustedDevices.find(d => d.deviceId === appState.selectedDeviceId);
      await doSend(text, appState.selectedDeviceId, targetDevice?.deviceName || 'Unknown');
    });
  }

  if (confirmNo) {
    confirmNo.addEventListener('click', () => {
      confirmPanel.setAttribute('hidden', '');
    });
  }
}

async function doSend(text, deviceId, deviceName) {
  const msg = Protocol.createClipboard({
    sourceDeviceId:   appState.device.deviceId,
    sourceDeviceName: appState.device.deviceName,
    text
  });

  const sent = connManager.sendTo(deviceId, msg);

  if (sent) {
    Toast.success(`Sent to ${deviceName}.`);

    if (appState.settings.historyEnabled) {
      const item = await History.add({
        text,
        direction:    Direction.SENT,
        sourceDevice: deviceName
      });
      if (item) {
        appState.history.unshift(item);
        updateHistoryBadge();
      }
    }
  } else {
    Toast.error('Failed to send. The device may have disconnected.');
  }
}

function updateCharCount() {
  const textarea  = document.getElementById('clipboard-textarea');
  const countEl   = document.getElementById('char-count');
  if (!textarea || !countEl) return;

  const len   = textarea.value.length;
  const bytes = Utils.getByteLength(textarea.value);
  const maxMB = (appState.settings.maxClipboardMB || 1);
  const maxB  = maxMB * 1024 * 1024;

  countEl.textContent = `${Utils.formatNumber(len)} chars · ${Utils.formatBytes(bytes)}`;
  countEl.className   = 'char-count';

  if (bytes > maxB) {
    countEl.classList.add('char-count--error');
  } else if (bytes > maxB * 0.8) {
    countEl.classList.add('char-count--warning');
  }
}

// ============================================================
// Dashboard Device List
// ============================================================

function renderDashboardDevices() {
  const container = document.getElementById('dashboard-device-list');
  if (!container) return;

  const connected = appState.trustedDevices.filter(d => {
    const conn = connManager.getConnection(d.deviceId);
    return conn && conn.status === ConnectionStatus.CONNECTED;
  });

  if (appState.trustedDevices.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 2rem 1rem;">
        <div class="empty-state-icon"><i class="ph-devices" aria-hidden="true"></i></div>
        <p class="empty-state-text">No paired devices yet. Use <strong>Pair Device</strong> to connect another device.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = appState.trustedDevices.map(device => {
    const conn   = connManager.getConnection(device.deviceId);
    const status = conn ? conn.status : 'disconnected';
    const isConn = status === ConnectionStatus.CONNECTED;

    return `
      <div class="device-select-item ${appState.selectedDeviceId === device.deviceId ? 'device-select-item--selected' : ''} 
           ${!isConn ? '' : ''}"
           data-device-id="${Utils.escapeHtml(device.deviceId)}"
           role="option"
           aria-selected="${appState.selectedDeviceId === device.deviceId}"
           tabindex="0">
        <div class="device-select-icon">
          ${renderDeviceIcon(device.deviceType)}
        </div>
        <div class="device-select-info">
          <div class="device-select-name">${Utils.escapeHtml(device.deviceName)}</div>
          <div class="device-select-status">
            ${renderStatusDot(status)}
            <span>${Utils.getStatusLabel(status)}</span>
          </div>
        </div>
        <div class="device-select-check">
          <i class="ph-check-circle ph-fill" aria-hidden="true"></i>
        </div>
      </div>
    `;
  }).join('');

  // Click handlers for device selection
  container.querySelectorAll('.device-select-item').forEach(el => {
    const activate = () => {
      const id = el.dataset.deviceId;
      const conn = connManager.getConnection(id);
      if (conn && conn.status !== ConnectionStatus.CONNECTED) {
        Toast.warning('This device is not currently connected.');
        return;
      }
      appState.selectedDeviceId = id;
      renderDashboardDevices();
      updateSendButton();
    };

    el.addEventListener('click', activate);
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') activate(); });
  });

  updateSendButton();
}

function updateSendButton() {
  const sendBtn = document.getElementById('send-clipboard-btn');
  if (!sendBtn) return;

  const deviceId = appState.selectedDeviceId;
  const conn     = deviceId ? connManager.getConnection(deviceId) : null;
  const ready    = conn && conn.isReady;

  sendBtn.disabled = !ready;

  const device = appState.trustedDevices.find(d => d.deviceId === deviceId);
  const name   = device?.deviceName || 'device';

  sendBtn.querySelector('.btn-label')
    ? (sendBtn.querySelector('.btn-label').textContent = ready ? `Send to ${name}` : 'Send')
    : null;
}

// ============================================================
// Devices View
// ============================================================

function renderDevicesView() {
  const container = document.getElementById('devices-list');
  if (!container) return;

  if (appState.trustedDevices.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon"><i class="ph-devices" aria-hidden="true"></i></div>
        <div class="empty-state-title">No trusted devices</div>
        <p class="empty-state-text">Pair with another device to start sharing clipboard content securely.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `<div class="device-grid">${
    appState.trustedDevices.map(device => renderDeviceCard(device)).join('')
  }</div>`;

  // Attach action handlers
  container.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', e => {
      const action   = btn.dataset.action;
      const deviceId = btn.dataset.deviceId;
      handleDeviceAction(action, deviceId);
    });
  });
}

function renderDeviceCard(device) {
  const conn        = connManager.getConnection(device.deviceId);
  const status      = conn ? conn.status : 'disconnected';
  const lastSeen    = device.lastSeen ? Utils.formatRelativeTime(device.lastSeen) : 'Never';
  const trustedAt   = device.trustedAt ? Utils.formatDateTime(device.trustedAt) : '—';

  return `
    <div class="device-card device-card--${status}" data-device-id="${Utils.escapeHtml(device.deviceId)}">
      <div class="device-card-header">
        <div class="device-card-icon">
          ${renderDeviceIcon(device.deviceType)}
        </div>
        <div class="device-card-meta">
          <div class="device-card-name">${Utils.escapeHtml(device.deviceName)}</div>
          <div class="device-card-id">${device.deviceId.slice(0, 12)}…</div>
        </div>
      </div>

      <div class="device-card-status-row">
        ${renderStatusBadge(status)}
      </div>

      <div class="device-card-body">
        <div class="device-info-row">
          <span class="device-info-label">Type</span>
          <span class="device-info-value">${Utils.escapeHtml(device.deviceType || 'unknown')}</span>
        </div>
        <div class="device-info-row">
          <span class="device-info-label">Last seen</span>
          <span class="device-info-value">${Utils.escapeHtml(lastSeen)}</span>
        </div>
        <div class="device-info-row">
          <span class="device-info-label">Trusted since</span>
          <span class="device-info-value">${Utils.escapeHtml(trustedAt)}</span>
        </div>
      </div>

      <div class="device-card-actions">
        ${status !== ConnectionStatus.CONNECTED ? `
          <button class="btn btn-secondary btn--sm" data-action="reconnect" data-device-id="${Utils.escapeHtml(device.deviceId)}"
                  aria-label="Reconnect ${Utils.escapeHtml(device.deviceName)}">
            <i class="ph-arrows-clockwise btn-icon" aria-hidden="true"></i> Reconnect
          </button>
        ` : `
          <button class="btn btn-secondary btn--sm" data-action="disconnect" data-device-id="${Utils.escapeHtml(device.deviceId)}"
                  aria-label="Disconnect ${Utils.escapeHtml(device.deviceName)}">
            <i class="ph-plugs btn-icon" aria-hidden="true"></i> Disconnect
          </button>
        `}
        <button class="btn btn-danger btn--sm" data-action="remove" data-device-id="${Utils.escapeHtml(device.deviceId)}"
                aria-label="Remove ${Utils.escapeHtml(device.deviceName)}">
          <i class="ph-trash btn-icon" aria-hidden="true"></i> Remove
        </button>
      </div>
    </div>
  `;
}

function handleDeviceAction(action, deviceId) {
  const device = appState.trustedDevices.find(d => d.deviceId === deviceId);

  if (action === 'disconnect') {
    connManager.disconnect(deviceId);
    handleStatusChange(deviceId, ConnectionStatus.DISCONNECTED);
    Toast.info(`Disconnected from ${device?.deviceName || 'device'}.`);

  } else if (action === 'reconnect') {
    Toast.info('To reconnect, use Pair Device on the other device and enter a new pairing code.');

  } else if (action === 'remove') {
    if (!confirm(`Remove "${device?.deviceName || 'this device'}" from trusted devices?\nThis will disconnect and remove all trust.`)) return;

    connManager.disconnect(deviceId);
    Devices.remove(deviceId);
    appState.trustedDevices = appState.trustedDevices.filter(d => d.deviceId !== deviceId);

    if (appState.selectedDeviceId === deviceId) {
      appState.selectedDeviceId = null;
    }

    renderDevicesView();
    renderDashboardDevices();
    updateNetworkStatus();
    Toast.success(`${device?.deviceName || 'Device'} removed.`);
  }
}

function updateConnectionStatuses() {
  // Refresh device cards to reflect current connection states
  if (Router.current() === 'devices') renderDevicesView();
  if (Router.current() === 'dashboard') {
    renderDashboardDevices();
    renderIncomingPanel();
  }
  updateNetworkStatus();
}

// ============================================================
// History View
// ============================================================

async function loadAndRenderHistory() {
  appState.history = await History.getAll();
  renderHistoryView();
}

function renderHistoryView() {
  const container = document.getElementById('history-list');
  const countEl   = document.getElementById('history-count');
  if (!container) return;

  const items = appState.history;

  if (countEl) countEl.textContent = `${items.length} item${items.length !== 1 ? 's' : ''}`;

  if (items.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon"><i class="ph-clock-clockwise" aria-hidden="true"></i></div>
        <div class="empty-state-title">No history yet</div>
        <p class="empty-state-text">Clipboard items you read, send, or receive will appear here.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = items.map(item => `
    <div class="history-item history-item--${item.direction}" data-id="${Utils.escapeHtml(item.id)}">
      <div class="history-item-header">
        ${directionLabel(item.direction)}
        <span class="history-item-source">${item.sourceDevice ? Utils.escapeHtml(item.sourceDevice) : ''}</span>
        <span class="history-item-time">${Utils.formatRelativeTime(item.timestamp)}</span>
      </div>
      <div class="history-item-preview">${Utils.escapeHtml(Utils.truncate(item.text, 200))}</div>
      <div class="history-item-footer">
        <span class="history-item-size">${Utils.formatBytes(item.size)}</span>
        <div class="history-item-actions">
          <button class="btn btn-secondary btn--sm" data-action="copy-history" data-id="${Utils.escapeHtml(item.id)}"
                  aria-label="Copy this clipboard item">
            <i class="ph-copy btn-icon" aria-hidden="true"></i> Copy
          </button>
          <button class="btn btn-ghost btn--sm btn--icon-only" data-action="delete-history" data-id="${Utils.escapeHtml(item.id)}"
                  aria-label="Delete this history item">
            <i class="ph-trash" aria-hidden="true"></i>
          </button>
        </div>
      </div>
    </div>
  `).join('');

  // Handlers
  container.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.action;
      const id     = btn.dataset.id;
      const item   = appState.history.find(i => i.id === id);

      if (action === 'copy-history' && item) {
        const result = await Clipboard.write(item.text);
        if (result.ok) Toast.success('Copied to clipboard.');
        else Toast.error(result.error);

      } else if (action === 'delete-history') {
        await History.remove(id);
        appState.history = appState.history.filter(i => i.id !== id);
        renderHistoryView();
        updateHistoryBadge();
      }
    });
  });
}

function updateHistoryBadge() {
  const badge = document.getElementById('history-badge');
  if (badge) {
    const count = appState.history.length;
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : count.toString();
      badge.removeAttribute('hidden');
    } else {
      badge.setAttribute('hidden', '');
    }
  }
}

// History search
function setupHistorySearch() {
  const searchInput = document.getElementById('history-search');
  if (!searchInput) return;

  const debouncedSearch = Utils.debounce(async () => {
    const q = searchInput.value.trim();
    if (q) {
      appState.history = await History.search(q);
    } else {
      appState.history = await History.getAll();
    }
    renderHistoryView();
  }, 300);

  searchInput.addEventListener('input', debouncedSearch);
}

// ============================================================
// Incoming Items Panel
// ============================================================

function renderIncomingPanel() {
  const panel = document.getElementById('incoming-panel');
  const items = appState.incomingItems;

  if (!panel) return;

  if (items.length === 0) {
    panel.setAttribute('hidden', '');
    return;
  }

  panel.removeAttribute('hidden');

  const list = document.getElementById('incoming-list');
  if (!list) return;

  list.innerHTML = items.map((item, idx) => `
    <div class="incoming-card" data-idx="${idx}">
      <div class="incoming-card-header">
        <div class="incoming-icon"><i class="ph-clipboard-text ph-fill" aria-hidden="true"></i></div>
        <div class="incoming-source">
          <div class="incoming-label">Incoming clipboard</div>
          <div class="incoming-device">${Utils.escapeHtml(item.sourceDeviceName || 'Unknown device')}</div>
        </div>
        <div class="incoming-time">${Utils.formatRelativeTime(new Date(item.timestamp).getTime())}</div>
      </div>
      <div class="incoming-preview">${Utils.escapeHtml(Utils.truncate(item.text, 160))}</div>
      <div class="incoming-actions">
        <button class="btn btn-primary btn--sm" data-action="copy-incoming" data-idx="${idx}"
                aria-label="Copy incoming text to clipboard">
          <i class="ph-copy btn-icon" aria-hidden="true"></i> Copy
        </button>
        <button class="btn btn-secondary btn--sm" data-action="load-incoming" data-idx="${idx}"
                aria-label="Load into editor">
          <i class="ph-pencil btn-icon" aria-hidden="true"></i> Load in editor
        </button>
        <button class="btn btn-ghost btn--sm btn--icon-only" data-action="dismiss-incoming" data-idx="${idx}"
                aria-label="Dismiss">
          <i class="ph-x" aria-hidden="true"></i>
        </button>
        <span class="incoming-size">${Utils.formatBytes(Utils.getByteLength(item.text))}</span>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.action;
      const idx    = parseInt(btn.dataset.idx, 10);
      const item   = appState.incomingItems[idx];
      if (!item) return;

      if (action === 'copy-incoming') {
        const result = await Clipboard.write(item.text);
        if (result.ok) {
          Toast.success('Copied to clipboard.');
          appState.incomingItems.splice(idx, 1);
          renderIncomingPanel();
        } else {
          Toast.error(result.error);
        }
      } else if (action === 'load-incoming') {
        const ta = document.getElementById('clipboard-textarea');
        if (ta) {
          ta.value = item.text;
          appState.clipboard = item.text;
          updateCharCount();
        }
        appState.incomingItems.splice(idx, 1);
        renderIncomingPanel();
        Router.navigate('dashboard');
        Toast.info('Loaded into editor.');
      } else if (action === 'dismiss-incoming') {
        appState.incomingItems.splice(idx, 1);
        renderIncomingPanel();
      }
    });
  });
}

// ============================================================
// WebRTC Callbacks
// ============================================================

function handlePeerMessage(remoteDeviceId, msg) {
  // Ensure sender is trusted
  const trusted = appState.trustedDevices.find(d => d.deviceId === remoteDeviceId);
  if (!trusted) {
    console.warn('[App] Message from untrusted device:', remoteDeviceId);
    return;
  }

  Devices.updateLastSeen(remoteDeviceId);

  if (msg.type === MessageType.CLIPBOARD) {
    handleIncomingClipboard(msg, trusted);
  } else if (msg.type === MessageType.DEVICE_INFO) {
    // Update device name if changed
    trusted.deviceName = msg.sourceDeviceName || trusted.deviceName;
    Devices.save(trusted);
    renderDevicesView();
    renderDashboardDevices();
  }
}

async function handleIncomingClipboard(msg, device) {
  const item = {
    text:             msg.text,
    timestamp:        msg.timestamp,
    sourceDeviceName: msg.sourceDeviceName || device.deviceName
  };

  appState.incomingItems.unshift(item);

  // Save to history
  if (appState.settings.historyEnabled) {
    const histItem = await History.add({
      text:         msg.text,
      direction:    Direction.RECEIVED,
      sourceDevice: device.deviceName
    });
    if (histItem) {
      appState.history.unshift(histItem);
      updateHistoryBadge();
    }
  }

  // Show dashboard and incoming panel
  renderIncomingPanel();

  if (Router.current() !== 'dashboard') {
    Toast.info(`Clipboard received from ${device.deviceName}. View on dashboard.`);
  } else {
    // Scroll to top
    const incomingPanel = document.getElementById('incoming-panel');
    if (incomingPanel) incomingPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function handleStatusChange(deviceId, status) {
  appState.connectionStatuses[deviceId] = status;

  // Update lastSeen on connect
  if (status === ConnectionStatus.CONNECTED) {
    Devices.updateLastSeen(deviceId);
    const device = appState.trustedDevices.find(d => d.deviceId === deviceId);
    if (device) {
      device.lastSeen = Date.now();
      Toast.success(`${device.deviceName} connected.`);
    }
  } else if (status === ConnectionStatus.DISCONNECTED || status === ConnectionStatus.FAILED) {
    const device = appState.trustedDevices.find(d => d.deviceId === deviceId);
    if (device && status === ConnectionStatus.DISCONNECTED) {
      Toast.warning(`${device.deviceName} disconnected.`);
    }
  }

  updateNetworkStatus();
  renderDevicesView();
  renderDashboardDevices();
}

function handleConnectionError(deviceId, error) {
  const device = appState.trustedDevices.find(d => d.deviceId === deviceId);
  const name   = device?.deviceName || deviceId;
  Toast.error(`Connection error with ${name}: ${error}`);
}

// ============================================================
// Pairing Modal
// ============================================================

function setupPairingModal() {
  // Open via any element with data-open-pairing
  document.querySelectorAll('[data-open-pairing]').forEach(el => {
    el.addEventListener('click', () => openPairingModal());
  });

  // Cancel buttons (close and abort session)
  const handleCancelPairing = () => {
    if (pairingManager) pairingManager.cancelSession();
    Modal.close('pairing-modal');
  };
  document.getElementById('pairing-cancel-btn')?.addEventListener('click', handleCancelPairing);
  document.getElementById('pairing-cancel-footer-btn')?.addEventListener('click', handleCancelPairing);

  // Tab switching (QR / Code)
  document.querySelectorAll('.pair-flow-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      appState.pairing.activeTab = target;
      document.querySelectorAll('.pair-flow-tab').forEach(t => t.classList.remove('pair-flow-tab--active'));
      tab.classList.add('pair-flow-tab--active');
      document.querySelectorAll('.pair-panel').forEach(p => p.classList.remove('pair-panel--active'));
      document.getElementById(`pair-panel-${target}`)?.classList.add('pair-panel--active');

      if (target === 'qr' && appState.pairing.activeTab !== 'qr') {
        refreshQRDisplay();
      }
    });
  });

  // Copy code
  const copyCodeBtn = document.getElementById('copy-pairing-code-btn');
  if (copyCodeBtn) {
    copyCodeBtn.addEventListener('click', () => {
      const code = document.getElementById('pairing-code-display')?.textContent;
      if (!code) return;
      navigator.clipboard.writeText(code).then(() => Toast.success('Pairing code copied.'));
    });
  }

  // Copy offer packet
  const copyPacketBtn = document.getElementById('copy-offer-packet-btn');
  if (copyPacketBtn) {
    copyPacketBtn.addEventListener('click', () => {
      if (appState.pairing.offerPayload) {
        navigator.clipboard.writeText(appState.pairing.offerPayload)
          .then(() => Toast.success('Pairing data copied.'));
      }
    });
  }

  // Approval modal
  document.getElementById('pairing-approve-btn')?.addEventListener('click', () => approvePairing());
  document.getElementById('pairing-reject-btn')?.addEventListener('click',  () => rejectPairing());
}

async function openPairingModal() {
  Modal.open('pairing-modal');

  // Start generating offer
  document.getElementById('pairing-generating')?.removeAttribute('hidden');
  document.getElementById('pairing-content')?.setAttribute('hidden', '');

  try {
    const { session, offerPayload } = await pairingManager.startInitiatorSession();
    appState.pairing.session      = session;
    appState.pairing.offerPayload = offerPayload;

    document.getElementById('pairing-generating')?.setAttribute('hidden', '');
    document.getElementById('pairing-content')?.removeAttribute('hidden');

    // Display code
    const codeEl = document.getElementById('pairing-code-display');
    if (codeEl) {
      codeEl.textContent = Utils.formatPairingCode(session.pairingCode);
    }

    // QR code
    refreshQRDisplay();

    // Countdown timer
    const timerEl = document.getElementById('pairing-timer');
    if (timerEl && appState.pairing.countdownTimer) {
      appState.pairing.countdownTimer.stop();
    }
    if (timerEl) {
      const timer = new CountdownTimer(timerEl, session.remainingSeconds, () => {
        Toast.warning('Pairing code expired. Generate a new one.');
        Modal.close('pairing-modal');
      });
      timer.start();
      appState.pairing.countdownTimer = timer;
    }

  } catch (e) {
    Toast.error(`Failed to start pairing: ${e.message}`);
    Modal.close('pairing-modal');
  }
}

function refreshQRDisplay() {
  const qrContainer = document.getElementById('qr-container');
  if (!qrContainer || !appState.pairing.offerPayload) return;

  QR.generate(qrContainer, appState.pairing.offerPayload, {
    width: 200, height: 200,
    colorDark: '#180E12', colorLight: '#E4DCCB'
  });
}

// ============================================================
// Pairing: Responder (Enter Code / Scan)
// ============================================================

function resetScannerUI() {
  QR.stopScanner();
  const videoEl     = document.getElementById('qr-video');
  const viewfinder  = document.getElementById('scanner-viewfinder');
  const laserBar    = document.getElementById('scanner-laser-bar');
  const placeholder = document.getElementById('scanner-placeholder');
  const startBtn    = document.getElementById('scan-qr-btn');
  const captureBtn  = document.getElementById('capture-qr-btn');
  const stopBtn     = document.getElementById('stop-scan-btn');

  if (videoEl)     videoEl.style.display = 'none';
  if (viewfinder)  viewfinder.style.display = 'none';
  if (laserBar)    laserBar.style.display = 'none';
  if (placeholder) placeholder.style.display = 'flex';
  if (startBtn) {
    startBtn.style.display = '';
    startBtn.disabled = false;
  }
  if (captureBtn)  captureBtn.style.display = 'none';
  if (stopBtn)     stopBtn.style.display = 'none';
}

async function startQRScanner() {
  const videoEl     = document.getElementById('qr-video');
  const viewfinder  = document.getElementById('scanner-viewfinder');
  const laserBar    = document.getElementById('scanner-laser-bar');
  const placeholder = document.getElementById('scanner-placeholder');
  const startBtn    = document.getElementById('scan-qr-btn');
  const captureBtn  = document.getElementById('capture-qr-btn');
  const stopBtn     = document.getElementById('stop-scan-btn');

  if (!videoEl) return;

  if (startBtn)    startBtn.style.display = 'none';
  if (captureBtn)  captureBtn.style.display = '';
  if (stopBtn)     stopBtn.style.display = '';
  if (placeholder) placeholder.style.display = 'none';
  if (viewfinder)  viewfinder.style.display = 'block';
  if (laserBar)    laserBar.style.display = 'block';

  await QR.startScanner(
    videoEl,
    async (data) => {
      // Auto-detected QR code
      resetScannerUI();
      const textarea = document.getElementById('paste-packet-input');
      if (textarea) textarea.value = data;
      Toast.success('QR Code detected! Connecting...');
      await submitPacket();
    },
    (err) => {
      resetScannerUI();
      Toast.error(err);
    }
  );
}

function setupPairingEnterFlow() {
  // Open scanner modal (resets UI so user can click "Open Camera")
  const openScannerModal = () => {
    Modal.close('pairing-modal');
    resetScannerUI();
    Modal.open('enter-code-modal');
    document.getElementById('tab-scan')?.click();
  };

  // Switch to "Enter Code / Scan" mode
  document.getElementById('switch-to-enter-btn')?.addEventListener('click', openScannerModal);
  document.getElementById('switch-to-enter-standalone')?.addEventListener('click', openScannerModal);

  // Open camera button
  document.getElementById('scan-qr-btn')?.addEventListener('click', () => {
    startQRScanner();
  });

  // Manual Scan/Capture QR button
  document.getElementById('capture-qr-btn')?.addEventListener('click', async () => {
    const code = QR.scanCurrentFrame();
    if (code) {
      resetScannerUI();
      const textarea = document.getElementById('paste-packet-input');
      if (textarea) textarea.value = code;
      Toast.success('QR Code captured! Connecting...');
      await submitPacket();
    } else {
      Toast.warning('No QR code detected. Point your camera clearly at the QR code and try again.');
    }
  });

  // Stop scanner button
  document.getElementById('stop-scan-btn')?.addEventListener('click', resetScannerUI);

  // Submit code (manual entry)
  document.getElementById('enter-code-submit-btn')?.addEventListener('click', () => {
    submitPairingCode();
  });

  // Submit paste packet
  document.getElementById('paste-packet-submit-btn')?.addEventListener('click', () => {
    submitPacket();
  });

  // Close enter-code modal handlers
  const handleCloseEnterModal = () => {
    resetScannerUI();
    Modal.close('enter-code-modal');
  };
  document.getElementById('enter-code-close-btn')?.addEventListener('click', handleCloseEnterModal);
  document.getElementById('enter-code-cancel-footer-btn')?.addEventListener('click', handleCloseEnterModal);
  document.getElementById('scan-cancel-footer-btn')?.addEventListener('click', handleCloseEnterModal);
  document.getElementById('responder-done-btn')?.addEventListener('click', handleCloseEnterModal);

  // Code input keyboard
  document.getElementById('pairing-code-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') submitPairingCode();
  });

  // Response packet — copy
  document.getElementById('copy-response-btn')?.addEventListener('click', () => {
    const packet = document.getElementById('response-packet-display')?.textContent;
    if (packet) {
      navigator.clipboard.writeText(packet).then(() => Toast.success('Response copied. Paste this on the other device.'));
    }
  });

  // Initiator: paste response
  document.getElementById('apply-response-btn')?.addEventListener('click', () => {
    applyResponsePacket();
  });
}

async function submitPairingCode() {
  const input = document.getElementById('pairing-code-input');
  if (!input) return;

  const code = input.value.trim();
  if (!Security.isValidPairingCode(code)) {
    Toast.error('Invalid pairing code. Enter the 8-character code from the other device.');
    input.focus();
    return;
  }

  Toast.info('Please use the paste method to enter the full connection data from the other device.');
}

async function submitPacket() {
  const textarea = document.getElementById('paste-packet-input');
  if (!textarea) return;

  const raw = textarea.value.trim();
  if (!raw) {
    Toast.warning('Please paste the connection data first.');
    textarea.focus();
    return;
  }

  try {
    const session = await pairingManager.processOffer(raw);
    if (!session) return; // error already shown

    // Show response packet for user to send back
    const pending = session.getPendingRequest();
    if (!pending) return;

    textarea.value = '';
    document.getElementById('responder-result')?.removeAttribute('hidden');
    const displayEl = document.getElementById('response-packet-display');
    if (displayEl) displayEl.textContent = pending.responsePayload;

    // Show approval UI
    document.getElementById('pending-request-name').textContent = pending.deviceName || 'Unknown Device';
    Modal.open('pairing-request-modal');

  } catch (e) {
    Toast.error(`Failed to process pairing data: ${e.message}`);
  }
}

function approvePairing() {
  const responsePacket = pairingManager.acceptRequest();
  Modal.close('pairing-request-modal');

  if (responsePacket) {
    // Show response packet to share with initiator
    const displayEl = document.getElementById('response-packet-display');
    if (displayEl) displayEl.textContent = responsePacket;

    document.getElementById('responder-result')?.removeAttribute('hidden');
    Toast.success('Pairing approved. Share the response data with the other device.');
  }

  // Refresh trusted devices
  refreshTrustedDevices();
}

function rejectPairing() {
  pairingManager.rejectRequest();
  Modal.close('pairing-request-modal');
  Modal.close('enter-code-modal');
  Toast.info('Pairing request rejected.');
}

async function applyResponsePacket() {
  const input = document.getElementById('response-paste-input');
  if (!input) return;

  const raw = input.value.trim();
  if (!raw) {
    Toast.warning('Paste the response data from the other device first.');
    input.focus();
    return;
  }

  try {
    await pairingManager.processResponse(raw);
    input.value = '';
    Modal.close('pairing-modal');
    Toast.success('Connection established successfully.');
  } catch (e) {
    Toast.error(`Failed to apply response: ${e.message}`);
  }
}

function onPairingComplete(device) {
  Devices.save(device);
  appState.trustedDevices.push(device);
  refreshTrustedDevices();
  Toast.success(`${device.deviceName} is now trusted.`);
}

function onPairingRequest(info) {
  document.getElementById('pending-request-name').textContent = info.deviceName || 'Unknown Device';
  document.getElementById('pending-request-id').textContent  = info.deviceId?.slice(0, 12) + '…' || '';
  Modal.open('pairing-request-modal');
}

function refreshTrustedDevices() {
  renderDevicesView();
  renderDashboardDevices();
  updateNetworkStatus();
}

async function clearAllHistory() {
  if (!confirm('Clear all clipboard history? This cannot be undone.')) return;
  await History.clearAll();
  appState.history = [];
  renderHistoryView();
  updateHistoryBadge();
  Toast.success('History cleared.');
  await renderSettingsView();
}

// ============================================================
// Settings View
// ============================================================

async function renderSettingsView() {
  const s = await Settings.load();

  const deviceNameInput = document.getElementById('settings-device-name');
  if (deviceNameInput && appState.device) {
    deviceNameInput.value = appState.device.deviceName;
  }

  const historyEnabled = document.getElementById('setting-history-enabled');
  if (historyEnabled) historyEnabled.checked = !!s.historyEnabled;

  const maxMB = document.getElementById('setting-max-mb');
  if (maxMB) {
    maxMB.value = s.maxClipboardMB || 1;
    document.getElementById('setting-max-mb-value').textContent = `${s.maxClipboardMB || 1} MB`;
  }

  const requireConfirm = document.getElementById('setting-require-confirm');
  if (requireConfirm) requireConfirm.checked = !!s.requireSendConfirm;

  const pairingTimeout = document.getElementById('setting-pairing-timeout');
  if (pairingTimeout) pairingTimeout.value = s.pairingTimeoutMin || 10;

  const autoClear = document.getElementById('setting-auto-clear');
  if (autoClear) autoClear.checked = !!s.autoClearHistory;

  // Device ID display
  const deviceIdEl = document.getElementById('settings-device-id');
  if (deviceIdEl && appState.device) {
    deviceIdEl.textContent = appState.device.deviceId;
  }

  // History count
  const histCountEl = document.getElementById('settings-history-count');
  if (histCountEl) {
    const count = await History.count();
    histCountEl.textContent = `${count} item${count !== 1 ? 's' : ''}`;
  }
}

function setupSettingsHandlers() {
  // Save device name
  document.getElementById('settings-save-name-btn')?.addEventListener('click', async () => {
    const input = document.getElementById('settings-device-name');
    const name  = input?.value.trim();
    if (!name) {
      Toast.error('Device name cannot be empty.');
      return;
    }

    appState.device.deviceName = name;
    await Settings.set('localDevice', appState.device);
    renderSidebarDevice();
    Toast.success('Device name updated.');
  });

  // History toggle
  document.getElementById('setting-history-enabled')?.addEventListener('change', async e => {
    await Settings.set('historyEnabled', e.target.checked);
    appState.settings.historyEnabled = e.target.checked;
  });

  // Max MB slider
  document.getElementById('setting-max-mb')?.addEventListener('input', async e => {
    const val = parseFloat(e.target.value);
    document.getElementById('setting-max-mb-value').textContent = `${val} MB`;
    await Settings.set('maxClipboardMB', val);
    appState.settings.maxClipboardMB = val;
  });

  // Require confirm
  document.getElementById('setting-require-confirm')?.addEventListener('change', async e => {
    await Settings.set('requireSendConfirm', e.target.checked);
    appState.settings.requireSendConfirm = e.target.checked;
  });

  // Auto-clear
  document.getElementById('setting-auto-clear')?.addEventListener('change', async e => {
    await Settings.set('autoClearHistory', e.target.checked);
    appState.settings.autoClearHistory = e.target.checked;
  });

  // Clear history (settings page)
  document.getElementById('settings-clear-history-btn')?.addEventListener('click', () => {
    clearAllHistory();
  });

  // Clear history (history view)
  document.getElementById('clear-history-btn')?.addEventListener('click', () => {
    clearAllHistory();
  });


  // Clear all data
  document.getElementById('settings-clear-all-btn')?.addEventListener('click', async () => {
    if (!confirm('Clear ALL local data including device identity, trusted devices, and history?\n\nThis cannot be undone.')) return;
    await Storage.clearAllData();
    Settings.invalidateCache();
    Toast.success('All local data cleared. Reloading…');
    setTimeout(() => location.reload(), 1500);
  });

  // Compat check
  document.getElementById('settings-compat-btn')?.addEventListener('click', () => {
    Modal.open('compat-modal');
  });

  // Compat modal close
  document.getElementById('compat-modal-close')?.addEventListener('click', () => {
    Modal.close('compat-modal');
  });
}

// ============================================================
// Global Keyboard
// ============================================================

function setupGlobalKeyboard() {
  document.addEventListener('keydown', e => {
    // Escape closes modals
    if (e.key === 'Escape') {
      Modal.closeAll();
      QR.stopScanner();
    }
  });

  // Setup history search (done here after DOM is ready)
  setupHistorySearch();
}

// ============================================================
// Service Worker
// ============================================================

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.register('./sw.js')
    .then(reg => {
      console.log('[App] Service Worker registered:', reg.scope);
    })
    .catch(err => {
      console.warn('[App] Service Worker registration failed:', err);
    });
}

// ============================================================
// Start
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  // Expose navigation helpers for inline script usage
  window._navigate = (view) => Router.navigate(view);
  window._modalOpen = (id) => Modal.open(id);

  bootstrap();
});
