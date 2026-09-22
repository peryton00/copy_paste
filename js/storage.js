/**
 * LAN CLIPBOARD — Storage Module
 * IndexedDB-backed persistent storage for devices, history, and settings.
 * Falls back to localStorage for simple key-value settings.
 */

'use strict';

const DB_NAME    = 'lan-clipboard-db';
const DB_VERSION = 1;

const STORES = {
  devices:  'devices',
  history:  'history',
  settings: 'settings'
};

let db = null;

/**
 * Open (or upgrade) the IndexedDB database.
 */
async function openDB() {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = e => {
      const database = e.target.result;

      // Devices store
      if (!database.objectStoreNames.contains(STORES.devices)) {
        const devStore = database.createObjectStore(STORES.devices, { keyPath: 'deviceId' });
        devStore.createIndex('trustedAt', 'trustedAt', { unique: false });
      }

      // History store
      if (!database.objectStoreNames.contains(STORES.history)) {
        const histStore = database.createObjectStore(STORES.history, { keyPath: 'id' });
        histStore.createIndex('timestamp', 'timestamp', { unique: false });
        histStore.createIndex('direction', 'direction', { unique: false });
      }

      // Settings store (simple key-value)
      if (!database.objectStoreNames.contains(STORES.settings)) {
        database.createObjectStore(STORES.settings, { keyPath: 'key' });
      }
    };

    req.onsuccess = e => {
      db = e.target.result;
      db.onerror = err => console.error('[Storage] DB error:', err);
      resolve(db);
    };

    req.onerror = e => {
      reject(new Error(`IndexedDB open failed: ${e.target.error}`));
    };
  });
}

/**
 * Generic transaction helper
 */
async function withStore(storeName, mode, fn) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = fn(store);

    if (result && typeof result.onsuccess !== 'undefined') {
      result.onsuccess = e => resolve(e.target.result);
      result.onerror   = e => reject(e.target.error);
    } else {
      tx.oncomplete = () => resolve(result);
      tx.onerror    = e => reject(e.target.error);
    }
  });
}

/**
 * Generic get-all from a store
 */
async function getAll(storeName) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = database.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req   = store.getAll();
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

export const Storage = {

  /**
   * Check if IndexedDB is available
   */
  isAvailable() {
    return typeof indexedDB !== 'undefined';
  },

  // ---- Settings ----

  async getSetting(key, defaultValue = null) {
    try {
      return await withStore(STORES.settings, 'readonly', store => store.get(key))
        .then(rec => rec ? rec.value : defaultValue);
    } catch {
      // Fallback to localStorage
      const val = localStorage.getItem(`lancb_${key}`);
      return val !== null ? JSON.parse(val) : defaultValue;
    }
  },

  async setSetting(key, value) {
    try {
      await withStore(STORES.settings, 'readwrite', store => store.put({ key, value }));
    } catch {
      localStorage.setItem(`lancb_${key}`, JSON.stringify(value));
    }
  },

  async deleteSetting(key) {
    try {
      await withStore(STORES.settings, 'readwrite', store => store.delete(key));
    } catch {
      localStorage.removeItem(`lancb_${key}`);
    }
  },

  // ---- Devices ----

  async saveDevice(device) {
    await withStore(STORES.devices, 'readwrite', store => store.put(device));
  },

  async getDevice(deviceId) {
    return withStore(STORES.devices, 'readonly', store => store.get(deviceId));
  },

  async getAllDevices() {
    return getAll(STORES.devices);
  },

  async removeDevice(deviceId) {
    await withStore(STORES.devices, 'readwrite', store => store.delete(deviceId));
  },

  async clearAllDevices() {
    await withStore(STORES.devices, 'readwrite', store => store.clear());
  },

  // ---- History ----

  async addHistoryItem(item) {
    await withStore(STORES.history, 'readwrite', store => store.put(item));
  },

  async getHistoryItem(id) {
    return withStore(STORES.history, 'readonly', store => store.get(id));
  },

  async getAllHistory() {
    const items = await getAll(STORES.history);
    // Sort by timestamp descending
    return items.sort((a, b) => b.timestamp - a.timestamp);
  },

  async searchHistory(query) {
    const all   = await this.getAllHistory();
    const lower = query.toLowerCase();
    return all.filter(item =>
      item.text.toLowerCase().includes(lower) ||
      (item.sourceDevice && item.sourceDevice.toLowerCase().includes(lower))
    );
  },

  async removeHistoryItem(id) {
    await withStore(STORES.history, 'readwrite', store => store.delete(id));
  },

  async clearHistory() {
    await withStore(STORES.history, 'readwrite', store => store.clear());
  },

  /**
   * Trim history to maxItems (keep newest)
   */
  async trimHistory(maxItems = 200) {
    const all = await this.getAllHistory(); // already sorted newest first
    if (all.length <= maxItems) return;
    const toDelete = all.slice(maxItems);
    const database = await openDB();
    const tx = database.transaction(STORES.history, 'readwrite');
    const store = tx.objectStore(STORES.history);
    toDelete.forEach(item => store.delete(item.id));
    return new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror = e => rej(e.target.error);
    });
  },

  // ---- Full clear ----

  async clearAllData() {
    const database = await openDB();
    const tx = database.transaction(
      [STORES.devices, STORES.history, STORES.settings],
      'readwrite'
    );
    tx.objectStore(STORES.devices).clear();
    tx.objectStore(STORES.history).clear();
    tx.objectStore(STORES.settings).clear();

    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = e => reject(e.target.error);
    });
  }
};
