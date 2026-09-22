/**
 * LAN CLIPBOARD — Settings Module
 * Persisted user preferences.
 */

'use strict';

import { Storage } from './storage.js';

const DEFAULTS = {
  deviceName:          'My Device',
  historyEnabled:      true,
  maxHistoryItems:     200,
  maxClipboardMB:      1,
  autoClearHistory:    false,
  autoClearDays:       30,
  pairingTimeoutMin:   10,
  requireSendConfirm:  false,
  theme:               'dark'  // always dark for this app
};

let _cache = null;

export const Settings = {

  DEFAULTS,

  async load() {
    if (_cache) return _cache;
    const stored = await Storage.getSetting('app_settings', {});
    _cache = { ...DEFAULTS, ...stored };
    return _cache;
  },

  async get(key) {
    const s = await this.load();
    return s[key] ?? DEFAULTS[key];
  },

  async set(key, value) {
    const s = await this.load();
    s[key] = value;
    await Storage.setSetting('app_settings', s);
    _cache = s;
  },

  async setAll(values) {
    const s = await this.load();
    Object.assign(s, values);
    await Storage.setSetting('app_settings', s);
    _cache = s;
  },

  async reset() {
    _cache = { ...DEFAULTS };
    await Storage.setSetting('app_settings', _cache);
    return _cache;
  },

  invalidateCache() {
    _cache = null;
  },

  /**
   * Max clipboard bytes from settings
   */
  async getMaxClipboardBytes() {
    const mb = await this.get('maxClipboardMB');
    return Math.max(0.1, Math.min(mb, 10)) * 1024 * 1024;
  }
};
