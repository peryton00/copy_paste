/**
 * LAN CLIPBOARD — Security Module
 * Cryptographically secure ID and token generation using Web Crypto API
 */

'use strict';

export const Security = {

  /**
   * Check if Web Crypto API is available
   */
  isAvailable() {
    return !!(window.crypto && window.crypto.getRandomValues && window.crypto.subtle);
  },

  /**
   * Generate a cryptographically secure random hex string
   * @param {number} bytes - number of random bytes (hex string will be 2x length)
   */
  randomHex(bytes = 16) {
    const arr = new Uint8Array(bytes);
    window.crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  },

  /**
   * Generate a cryptographically secure device ID
   * Format: 32 hex characters (128-bit entropy)
   */
  generateDeviceId() {
    return this.randomHex(16);
  },

  /**
   * Generate a cryptographically secure message ID
   */
  generateMessageId() {
    return this.randomHex(12);
  },

  /**
   * Generate a pairing token (used in the pairing handshake)
   * 32 hex chars = 128-bit entropy
   */
  generatePairingToken() {
    return this.randomHex(16);
  },

  /**
   * Generate a human-readable pairing code
   * Format: 8 alphanumeric chars (no ambiguous chars: 0/O, 1/I/L)
   * ~38 bits of entropy — sufficient for short-lived manual entry
   */
  generatePairingCode() {
    const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 32 chars
    const arr = new Uint8Array(8);
    window.crypto.getRandomValues(arr);
    return Array.from(arr)
      .map(b => ALPHABET[b % ALPHABET.length])
      .join('');
  },

  /**
   * Generate a secure session nonce
   */
  generateNonce() {
    return this.randomHex(8);
  },

  /**
   * Compute a SHA-256 hash of a string (returns hex string)
   */
  async sha256(text) {
    if (!this.isAvailable()) throw new Error('Web Crypto API not available');
    const enc = new TextEncoder();
    const buf = await window.crypto.subtle.digest('SHA-256', enc.encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  },

  /**
   * Generate a verification fingerprint for a pairing session
   * Both sides can compute this from shared info to confirm authenticity
   */
  async generateFingerprint(deviceId, pairingToken, nonce) {
    const data = `${deviceId}:${pairingToken}:${nonce}`;
    return (await this.sha256(data)).slice(0, 16);
  },

  /**
   * Constant-time string comparison to prevent timing attacks
   * Both strings must be same length for this to be effective
   */
  safeCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
  },

  /**
   * Validate a device ID (must be 32 hex chars)
   */
  isValidDeviceId(id) {
    return typeof id === 'string' && /^[0-9a-f]{32}$/.test(id);
  },

  /**
   * Validate a pairing token
   */
  isValidPairingToken(token) {
    return typeof token === 'string' && /^[0-9a-f]{32}$/.test(token);
  },

  /**
   * Validate a pairing code (8 alphanumeric chars, no dash)
   */
  isValidPairingCode(code) {
    const normalized = code.replace(/[-\s]/g, '').toUpperCase();
    return /^[A-Z0-9]{8}$/.test(normalized);
  },

  /**
   * Check if a pairing session has expired
   * @param {number} createdAt - unix ms timestamp
   * @param {number} ttlMs - expiry in milliseconds (default 10 min)
   */
  isPairingExpired(createdAt, ttlMs = 10 * 60 * 1000) {
    return Date.now() - createdAt > ttlMs;
  },

  /**
   * Generate ECDH key pair for future encryption (optional enhancement)
   * Returns CryptoKeyPair
   */
  async generateECDHKeyPair() {
    if (!this.isAvailable()) throw new Error('Web Crypto API not available');
    return window.crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits']
    );
  },

  /**
   * Export a CryptoKey to raw base64
   */
  async exportPublicKey(key) {
    const raw = await window.crypto.subtle.exportKey('raw', key);
    return btoa(String.fromCharCode(...new Uint8Array(raw)));
  }
};
