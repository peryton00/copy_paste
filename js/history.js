/**
 * LAN CLIPBOARD — History Module
 * Manages local clipboard history using IndexedDB via Storage module.
 */

'use strict';

import { Storage } from './storage.js';
import { Security } from './security.js';
import { Utils }   from './utils.js';

export const Direction = Object.freeze({
  SENT:     'sent',
  RECEIVED: 'received',
  LOCAL:    'local'
});

export const History = {

  /**
   * Add a clipboard entry to history.
   * @param {object} params
   * @param {string} params.text
   * @param {string} params.direction - 'sent' | 'received' | 'local'
   * @param {string} [params.sourceDevice]
   * @param {number} [params.maxBytes]  - from settings
   */
  async add({ text, direction, sourceDevice = null, maxBytes = 1024 * 1024 }) {
    if (!text || typeof text !== 'string') return null;

    const bytes = Utils.getByteLength(text);

    const item = {
      id:          Security.generateMessageId(),
      text,
      timestamp:   Date.now(),
      direction,
      sourceDevice,
      size:        bytes
    };

    try {
      await Storage.addHistoryItem(item);
      // Trim to keep last 200 items
      await Storage.trimHistory(200);
    } catch (e) {
      console.error('[History] Failed to save item:', e);
    }

    return item;
  },

  /**
   * Get all history items (sorted newest first).
   */
  async getAll() {
    try {
      return await Storage.getAllHistory();
    } catch {
      return [];
    }
  },

  /**
   * Search history by query string.
   */
  async search(query) {
    if (!query || !query.trim()) return this.getAll();
    try {
      return await Storage.searchHistory(query.trim());
    } catch {
      return [];
    }
  },

  /**
   * Delete one item.
   */
  async remove(id) {
    try {
      await Storage.removeHistoryItem(id);
    } catch (e) {
      console.error('[History] Failed to remove item:', e);
    }
  },

  /**
   * Clear all history.
   */
  async clearAll() {
    try {
      await Storage.clearHistory();
    } catch (e) {
      console.error('[History] Failed to clear history:', e);
    }
  },

  /**
   * Get history count
   */
  async count() {
    const all = await this.getAll();
    return all.length;
  }
};
