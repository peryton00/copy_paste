/**
 * LAN CLIPBOARD — Clipboard Module
 * Wraps the browser Clipboard API with graceful degradation.
 */

'use strict';

import { Utils } from './utils.js';

const MAX_CLIPBOARD_BYTES = 1024 * 1024; // 1 MB default (configurable)

export const Clipboard = {

  /**
   * Check if the Clipboard API is available
   */
  isAvailable() {
    return !!(navigator.clipboard && typeof navigator.clipboard.readText === 'function');
  },

  /**
   * Check if we are in a secure context (required for Clipboard API)
   */
  isSecureContext() {
    return window.isSecureContext === true;
  },

  /**
   * Read text from the system clipboard.
   * Returns { ok: true, text } or { ok: false, error }
   */
  async read() {
    if (!this.isSecureContext()) {
      return { ok: false, error: 'Clipboard access requires a secure context (HTTPS or localhost).' };
    }

    if (!this.isAvailable()) {
      return { ok: false, error: 'Clipboard API is not supported in this browser.' };
    }

    try {
      const text = await navigator.clipboard.readText();
      return { ok: true, text: text || '' };
    } catch (e) {
      if (e.name === 'NotAllowedError') {
        return { ok: false, error: 'Clipboard read permission was denied. Allow clipboard access in your browser.' };
      }
      return { ok: false, error: `Could not read clipboard: ${e.message}` };
    }
  },

  /**
   * Write text to the system clipboard.
   * Returns { ok: true } or { ok: false, error }
   */
  async write(text) {
    if (!this.isSecureContext()) {
      return { ok: false, error: 'Clipboard access requires a secure context (HTTPS or localhost).' };
    }

    if (!this.isAvailable()) {
      // Fallback: execCommand
      return this._fallbackWrite(text);
    }

    try {
      await navigator.clipboard.writeText(text);
      return { ok: true };
    } catch (e) {
      if (e.name === 'NotAllowedError') {
        return this._fallbackWrite(text);
      }
      return { ok: false, error: `Could not write to clipboard: ${e.message}` };
    }
  },

  /**
   * Legacy execCommand fallback for write
   */
  _fallbackWrite(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) {
        return { ok: true };
      }
      return { ok: false, error: 'execCommand copy failed.' };
    } catch (e) {
      return { ok: false, error: `Clipboard write failed: ${e.message}` };
    }
  },

  /**
   * Validate clipboard text size
   * Returns { ok: true } or { ok: false, error }
   */
  validateSize(text, maxBytes = MAX_CLIPBOARD_BYTES) {
    const bytes = Utils.getByteLength(text);
    if (bytes > maxBytes) {
      return {
        ok: false,
        error: `Clipboard content is too large to send (${Utils.formatBytes(bytes)} / ${Utils.formatBytes(maxBytes)} limit).`
      };
    }
    return { ok: true, bytes };
  },

  MAX_CLIPBOARD_BYTES
};
