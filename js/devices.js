/**
 * LAN CLIPBOARD — Devices Module
 * Manages trusted device registry and session state.
 */

'use strict';

import { Storage } from './storage.js';
import { Security } from './security.js';
import { Utils }   from './utils.js';

export const Devices = {

  /**
   * Load all trusted devices from storage.
   */
  async getAll() {
    try {
      return await Storage.getAllDevices();
    } catch {
      return [];
    }
  },

  /**
   * Save / update a trusted device record.
   */
  async save(device) {
    await Storage.saveDevice(device);
  },

  /**
   * Remove a trusted device.
   */
  async remove(deviceId) {
    await Storage.removeDevice(deviceId);
  },

  /**
   * Clear all trusted devices.
   */
  async clearAll() {
    await Storage.clearAllDevices();
  },

  /**
   * Mark a device as last seen now.
   */
  async updateLastSeen(deviceId) {
    const device = await Storage.getDevice(deviceId);
    if (device) {
      device.lastSeen = Date.now();
      await Storage.saveDevice(device);
    }
  },

  /**
   * Create a new local device identity.
   */
  createLocalDevice(name) {
    return {
      deviceId:   Security.generateDeviceId(),
      deviceName: name || 'My Device',
      deviceType: Utils.detectDeviceType(),
      createdAt:  Date.now()
    };
  },

  /**
   * Create a trusted device record from pairing info.
   */
  createFromPairing({ deviceId, deviceName, deviceType }) {
    return {
      deviceId,
      deviceName: deviceName || 'Unknown Device',
      deviceType: deviceType || 'desktop',
      trustedAt:  Date.now(),
      lastSeen:   Date.now()
    };
  },

  /**
   * Check if a device ID is in the trusted list.
   */
  async isTrusted(deviceId) {
    const devices = await this.getAll();
    return devices.some(d => d.deviceId === deviceId);
  }
};
