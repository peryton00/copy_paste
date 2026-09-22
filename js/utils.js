/**
 * LAN CLIPBOARD — Utility Functions
 * Pure helper functions with no side effects
 */

'use strict';

export const Utils = {

  /**
   * Format bytes to human-readable size string
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const val = bytes / Math.pow(1024, i);
    return `${val % 1 === 0 ? val : val.toFixed(1)} ${sizes[i]}`;
  },

  /**
   * Format timestamp to relative time string
   */
  formatRelativeTime(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 5) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
  },

  /**
   * Format timestamp to readable date+time
   */
  formatDateTime(timestamp) {
    return new Date(timestamp).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  },

  /**
   * Format pairing code with dash separator
   * e.g. "7F4K92MX" -> "7F4K-92MX"
   */
  formatPairingCode(code) {
    const clean = code.replace(/[-\s]/g, '').toUpperCase();
    return clean.slice(0, 4) + '-' + clean.slice(4);
  },

  /**
   * Strip dash from pairing code for comparison
   */
  normalizePairingCode(code) {
    return code.replace(/[-\s]/g, '').toUpperCase();
  },

  /**
   * Truncate text to given length
   */
  truncate(text, length = 120) {
    if (!text || text.length <= length) return text;
    return text.slice(0, length) + '…';
  },

  /**
   * Escape HTML to prevent XSS when setting innerHTML
   */
  escapeHtml(str) {
    if (typeof str !== 'string') return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return str.replace(/[&<>"']/g, m => map[m]);
  },

  /**
   * Deep clone a plain object
   */
  clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  },

  /**
   * Debounce function
   */
  debounce(fn, delay) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  },

  /**
   * Wait for given milliseconds
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  /**
   * Detect device type from user agent
   */
  detectDeviceType() {
    const ua = navigator.userAgent.toLowerCase();
    if (/ipad|tablet|android(?!.*mobile)/i.test(ua)) return 'tablet';
    if (/mobile|android|iphone|ipod|windows phone/i.test(ua)) return 'mobile';
    return 'desktop';
  },

  /**
   * Get device type icon name (Phosphor)
   */
  getDeviceTypeIcon(type) {
    const icons = {
      mobile: 'ph-device-mobile',
      tablet: 'ph-device-tablet',
      desktop: 'ph-desktop',
      laptop: 'ph-laptop',
      unknown: 'ph-monitor'
    };
    return icons[type] || icons.unknown;
  },

  /**
   * Get status badge label
   */
  getStatusLabel(status) {
    const labels = {
      connected:    'Connected',
      connecting:   'Connecting',
      pairing:      'Pairing',
      offline:      'Offline',
      disconnected: 'Disconnected',
      error:        'Error'
    };
    return labels[status] || 'Unknown';
  },

  /**
   * Check if value is a non-empty string
   */
  isNonEmptyString(val) {
    return typeof val === 'string' && val.trim().length > 0;
  },

  /**
   * Check if byte length of text exceeds limit
   */
  getByteLength(str) {
    return new TextEncoder().encode(str).length;
  },

  /**
   * Generate timestamp string
   */
  nowISO() {
    return new Date().toISOString();
  },

  /**
   * Attempt to parse JSON safely
   */
  safeJsonParse(str) {
    try {
      return { ok: true, value: JSON.parse(str) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  /**
   * Format number with locale
   */
  formatNumber(n) {
    return n.toLocaleString();
  },

  /**
   * Generate a UUID v4 placeholder (non-crypto, for non-security use only)
   * Security-sensitive IDs must use Security.generateId()
   */
  pseudoUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
};
