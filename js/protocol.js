/**
 * LAN CLIPBOARD — Message Protocol
 * Structured message format, validation, and factory functions.
 * All messages exchanged over WebRTC DataChannels must conform to this protocol.
 */

'use strict';

import { Security } from './security.js';
import { Utils }    from './utils.js';

export const PROTOCOL_VERSION = 1;

export const MessageType = Object.freeze({
  // Pairing handshake
  PAIRING_OFFER:   'pairing-offer',
  PAIRING_ACK:     'pairing-ack',
  PAIRING_ACCEPT:  'pairing-accept',
  PAIRING_REJECT:  'pairing-reject',

  // Operational
  CLIPBOARD:       'clipboard',
  DEVICE_INFO:     'device-info',
  PING:            'ping',
  PONG:            'pong',
  DISCONNECT:      'disconnect',
  ERROR:           'error',
});

// Fields required in every message
const BASE_REQUIRED = ['type', 'version', 'messageId', 'timestamp', 'sourceDeviceId'];

// Per-type required fields
const TYPE_REQUIRED = {
  [MessageType.PAIRING_OFFER]: ['pairingToken', 'pairingCode', 'sourceDeviceName', 'sourceDeviceType'],
  [MessageType.PAIRING_ACK]:   ['pairingToken', 'fingerprint', 'sourceDeviceName', 'sourceDeviceType'],
  [MessageType.PAIRING_ACCEPT]:['pairingToken'],
  [MessageType.PAIRING_REJECT]:['reason'],
  [MessageType.CLIPBOARD]:     ['text', 'contentType', 'sourceDeviceName'],
  [MessageType.DEVICE_INFO]:   ['sourceDeviceName', 'sourceDeviceType'],
  [MessageType.PING]:          [],
  [MessageType.PONG]:          [],
  [MessageType.DISCONNECT]:    [],
  [MessageType.ERROR]:         ['errorCode', 'errorMessage'],
};

// Max allowed payload size in bytes (1 MB)
const MAX_PAYLOAD_BYTES = 1024 * 1024;

export const Protocol = {

  /**
   * Create a base message skeleton
   */
  createBase(type, sourceDeviceId) {
    return {
      type,
      version:       PROTOCOL_VERSION,
      messageId:     Security.generateMessageId(),
      timestamp:     Utils.nowISO(),
      sourceDeviceId
    };
  },

  /**
   * Factory — pairing offer (initiator → responder via QR/code)
   */
  createPairingOffer({ sourceDeviceId, sourceDeviceName, sourceDeviceType, pairingToken, pairingCode }) {
    return {
      ...this.createBase(MessageType.PAIRING_OFFER, sourceDeviceId),
      pairingToken,
      pairingCode,
      sourceDeviceName,
      sourceDeviceType
    };
  },

  /**
   * Factory — pairing acknowledgement (responder → initiator)
   */
  createPairingAck({ sourceDeviceId, sourceDeviceName, sourceDeviceType, pairingToken, fingerprint }) {
    return {
      ...this.createBase(MessageType.PAIRING_ACK, sourceDeviceId),
      pairingToken,
      fingerprint,
      sourceDeviceName,
      sourceDeviceType
    };
  },

  /**
   * Factory — accept pairing (after user approves)
   */
  createPairingAccept({ sourceDeviceId, pairingToken }) {
    return {
      ...this.createBase(MessageType.PAIRING_ACCEPT, sourceDeviceId),
      pairingToken
    };
  },

  /**
   * Factory — reject pairing
   */
  createPairingReject({ sourceDeviceId, reason = 'User rejected the pairing request.' }) {
    return {
      ...this.createBase(MessageType.PAIRING_REJECT, sourceDeviceId),
      reason
    };
  },

  /**
   * Factory — clipboard message
   */
  createClipboard({ sourceDeviceId, sourceDeviceName, text }) {
    return {
      ...this.createBase(MessageType.CLIPBOARD, sourceDeviceId),
      contentType:      'text/plain',
      sourceDeviceName,
      text,
      byteSize:         Utils.getByteLength(text)
    };
  },

  /**
   * Factory — device info broadcast
   */
  createDeviceInfo({ sourceDeviceId, sourceDeviceName, sourceDeviceType }) {
    return {
      ...this.createBase(MessageType.DEVICE_INFO, sourceDeviceId),
      sourceDeviceName,
      sourceDeviceType
    };
  },

  /**
   * Factory — ping
   */
  createPing(sourceDeviceId) {
    return this.createBase(MessageType.PING, sourceDeviceId);
  },

  /**
   * Factory — pong
   */
  createPong(sourceDeviceId) {
    return this.createBase(MessageType.PONG, sourceDeviceId);
  },

  /**
   * Factory — disconnect
   */
  createDisconnect(sourceDeviceId) {
    return this.createBase(MessageType.DISCONNECT, sourceDeviceId);
  },

  /**
   * Factory — error
   */
  createError({ sourceDeviceId, errorCode, errorMessage }) {
    return {
      ...this.createBase(MessageType.ERROR, sourceDeviceId),
      errorCode,
      errorMessage
    };
  },

  /**
   * Serialize a message to JSON string
   */
  serialize(msg) {
    return JSON.stringify(msg);
  },

  /**
   * Parse and validate an incoming message string.
   * Returns { ok: true, message } or { ok: false, error }
   */
  parse(raw) {
    // Size guard
    if (typeof raw !== 'string') {
      return { ok: false, error: 'Message is not a string' };
    }
    if (Utils.getByteLength(raw) > MAX_PAYLOAD_BYTES) {
      return { ok: false, error: 'Message exceeds maximum allowed size' };
    }

    // JSON parse
    const parsed = Utils.safeJsonParse(raw);
    if (!parsed.ok) {
      return { ok: false, error: `Malformed JSON: ${parsed.error}` };
    }

    const msg = parsed.value;

    // Validate base fields
    for (const field of BASE_REQUIRED) {
      if (!(field in msg)) {
        return { ok: false, error: `Missing required field: ${field}` };
      }
    }

    // Validate version
    if (msg.version !== PROTOCOL_VERSION) {
      return { ok: false, error: `Unsupported protocol version: ${msg.version}` };
    }

    // Validate type
    if (!Object.values(MessageType).includes(msg.type)) {
      return { ok: false, error: `Unknown message type: ${msg.type}` };
    }

    // Validate device ID format
    if (!Security.isValidDeviceId(msg.sourceDeviceId)) {
      return { ok: false, error: `Invalid sourceDeviceId format` };
    }

    // Validate type-specific required fields
    const typeRequired = TYPE_REQUIRED[msg.type] || [];
    for (const field of typeRequired) {
      if (!(field in msg) || msg[field] === null || msg[field] === undefined) {
        return { ok: false, error: `Missing field for ${msg.type}: ${field}` };
      }
    }

    // Clipboard-specific validation
    if (msg.type === MessageType.CLIPBOARD) {
      if (typeof msg.text !== 'string') {
        return { ok: false, error: 'Clipboard text must be a string' };
      }
      if (Utils.getByteLength(msg.text) > MAX_PAYLOAD_BYTES) {
        return { ok: false, error: 'Clipboard content exceeds maximum size' };
      }
    }

    return { ok: true, message: msg };
  },

  /**
   * Validate a pairing packet (offer or ack) more strictly
   */
  validatePairingOffer(msg) {
    if (!Security.isValidPairingToken(msg.pairingToken)) {
      return { ok: false, error: 'Invalid pairing token format' };
    }
    if (!Security.isValidPairingCode(msg.pairingCode)) {
      return { ok: false, error: 'Invalid pairing code format' };
    }
    if (!Utils.isNonEmptyString(msg.sourceDeviceName)) {
      return { ok: false, error: 'Invalid device name' };
    }
    return { ok: true };
  },

  MAX_PAYLOAD_BYTES
};
