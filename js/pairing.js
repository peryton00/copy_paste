/**
 * LAN CLIPBOARD — Pairing Module
 * Manages the pairing session lifecycle:
 * - Generating pairing offers (QR + code)
 * - Processing incoming pairing packets
 * - Token validation and expiry
 * - Approval workflow
 */

'use strict';

import { Security }                        from './security.js';
import { Protocol, MessageType }           from './protocol.js';
import { Utils }                           from './utils.js';

const PAIRING_TTL_MS = 10 * 60 * 1000; // 10 minutes

export const PairingStatus = Object.freeze({
  IDLE:       'idle',
  GENERATING: 'generating',   // Creating offer SDP
  WAITING:    'waiting',      // Offer shown, waiting for responder
  CONNECTING: 'connecting',   // Got response, establishing DC
  REQUESTING: 'requesting',   // Responder waiting for user approval
  ACCEPTED:   'accepted',
  REJECTED:   'rejected',
  EXPIRED:    'expired',
  ERROR:      'error'
});

/**
 * A single pairing session (one active at a time).
 */
export class PairingSession {
  constructor({ device, onRequest, onComplete, onExpire, onError }) {
    this.device    = device;
    this.onRequest = onRequest || (() => {});
    this.onComplete= onComplete|| (() => {});
    this.onExpire  = onExpire  || (() => {});
    this.onError   = onError   || (() => {});

    this.status       = PairingStatus.IDLE;
    this.pairingToken = Security.generatePairingToken();
    this.pairingCode  = Security.generatePairingCode();
    this.createdAt    = Date.now();
    this.nonce        = Security.generateNonce();

    this._expiryTimer = null;
    this._pendingRemote = null; // incoming pairing info awaiting user decision
  }

  // ---- Initiator side ----

  /**
   * Build the pairing offer payload that will be embedded in a QR code
   * or presented as a copy/paste packet.
   * This packet is NOT the WebRTC SDP — it contains the device identity
   * and pairing credentials. The WebRTC SDP exchange happens separately.
   */
  buildOfferPayload(encodedOffer) {
    return {
      lc:  1,                          // lan-clipboard protocol version
      did: this.device.deviceId,
      dn:  this.device.deviceName,
      dt:  this.device.deviceType,
      tok: this.pairingToken,
      cod: this.pairingCode,
      sdp: encodedOffer,               // WebRTC offer SDP
      ts:  this.createdAt
    };
  }

  /**
   * Serialize the offer payload to a compact JSON string (for QR).
   */
  serializeOffer(encodedOffer) {
    return JSON.stringify(this.buildOfferPayload(encodedOffer));
  }

  /**
   * Start expiry timer.
   */
  startExpiry() {
    this._expiryTimer = setTimeout(() => {
      this.status = PairingStatus.EXPIRED;
      this.onExpire();
    }, PAIRING_TTL_MS);
  }

  stopExpiry() {
    clearTimeout(this._expiryTimer);
    this._expiryTimer = null;
  }

  get remainingMs() {
    return Math.max(0, PAIRING_TTL_MS - (Date.now() - this.createdAt));
  }

  get remainingSeconds() {
    return Math.ceil(this.remainingMs / 1000);
  }

  // ---- Responder side ----

  /**
   * Parse and validate an incoming offer payload (from QR scan or paste).
   * Returns { ok: true, offer } or { ok: false, error }
   */
  static parseOfferPayload(raw) {
    let data;
    try {
      data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return { ok: false, error: 'Invalid pairing data format.' };
    }

    if (!data || typeof data !== 'object') {
      return { ok: false, error: 'Pairing data is not an object.' };
    }

    if (data.lc !== 1) {
      return { ok: false, error: 'Incompatible pairing protocol version.' };
    }

    if (!Security.isValidDeviceId(data.did)) {
      return { ok: false, error: 'Invalid device ID in pairing data.' };
    }

    if (!Security.isValidPairingToken(data.tok)) {
      return { ok: false, error: 'Invalid pairing token.' };
    }

    if (!Security.isValidPairingCode(data.cod)) {
      return { ok: false, error: 'Invalid pairing code.' };
    }

    if (!Utils.isNonEmptyString(data.dn)) {
      return { ok: false, error: 'Device name is missing.' };
    }

    if (!data.sdp || typeof data.sdp !== 'string') {
      return { ok: false, error: 'WebRTC offer is missing.' };
    }

    // Check expiry
    if (Security.isPairingExpired(data.ts, PAIRING_TTL_MS)) {
      return { ok: false, error: 'Pairing code has expired.' };
    }

    return {
      ok: true,
      offer: {
        deviceId:    data.did,
        deviceName:  data.dn,
        deviceType:  data.dt || 'desktop',
        pairingToken: data.tok,
        pairingCode:  data.cod,
        encodedOffer: data.sdp,
        timestamp:    data.ts
      }
    };
  }

  /**
   * Store pending remote pairing info for user decision.
   */
  setPendingRequest(remoteInfo) {
    this._pendingRemote = remoteInfo;
    this.status = PairingStatus.REQUESTING;
    this.onRequest(remoteInfo);
  }

  getPendingRequest() {
    return this._pendingRemote;
  }

  destroy() {
    this.stopExpiry();
    this._pendingRemote = null;
  }
}

/**
 * Pairing Manager — handles active sessions and coordinates with ConnectionManager.
 */
export class PairingManager {
  constructor({ device, connectionManager, onPairingComplete, onPairingRequest, onPairingError }) {
    this.device             = device;
    this.connectionManager  = connectionManager;
    this.onPairingComplete  = onPairingComplete || (() => {});
    this.onPairingRequest   = onPairingRequest  || (() => {});
    this.onPairingError     = onPairingError    || (() => {});

    this.activeSession      = null;
    this._pendingAnswerMap  = new Map(); // remoteDeviceId -> pendingAnswer callback
  }

  /**
   * Start a new pairing session as initiator.
   * Returns { session, encodedOffer, offerPayload }
   */
  async startInitiatorSession() {
    // Cancel any existing session
    this.cancelSession();

    const session = new PairingSession({
      device: this.device,
      onRequest: info => this.onPairingRequest(info),
      onComplete: () => {},
      onExpire: () => this.onPairingError('Pairing session expired.'),
      onError: err => this.onPairingError(err)
    });

    this.activeSession = session;

    // Create WebRTC offer
    const { encodedOffer } = await this.connectionManager.createOffer(
      '__pending__' // Temporary key; will be replaced when remote ID is known
    );

    const offerPayload = session.serializeOffer(encodedOffer);
    session.startExpiry();
    session.status = PairingStatus.WAITING;

    return { session, encodedOffer, offerPayload };
  }

  /**
   * Process an incoming offer (responder side) and create an answer.
   * Shows a pairing request to the user.
   */
  async processOffer(rawPayload) {
    const parsed = PairingSession.parseOfferPayload(rawPayload);
    if (!parsed.ok) {
      this.onPairingError(parsed.error);
      return null;
    }

    const { offer } = parsed;

    // Create answer via WebRTC
    const { encodedAnswer } = await this.connectionManager.createAnswer(
      offer.deviceId,
      offer.encodedOffer
    );

    // Build response payload
    const responsePayload = this._buildResponsePayload(offer, encodedAnswer);

    // Store pending info
    if (!this.activeSession) {
      this.activeSession = new PairingSession({
        device: this.device,
        onRequest: info => this.onPairingRequest(info),
        onComplete: () => {},
        onExpire: () => {},
        onError: err => this.onPairingError(err)
      });
    }

    this.activeSession.setPendingRequest({
      deviceId:      offer.deviceId,
      deviceName:    offer.deviceName,
      deviceType:    offer.deviceType,
      pairingToken:  offer.pairingToken,
      encodedAnswer,
      responsePayload
    });

    return this.activeSession;
  }

  /**
   * Build the response payload that the responder sends back to the initiator.
   */
  _buildResponsePayload(offer, encodedAnswer) {
    return JSON.stringify({
      lc:  1,
      did: this.device.deviceId,
      dn:  this.device.deviceName,
      dt:  this.device.deviceType,
      tok: offer.pairingToken,   // Echo token to prove we saw the offer
      sdp: encodedAnswer
    });
  }

  /**
   * Initiator processes a response payload (after the responder approves).
   */
  async processResponse(rawPayload) {
    let data;
    try {
      data = JSON.parse(rawPayload);
    } catch {
      this.onPairingError('Invalid response payload.');
      return;
    }

    if (!data || data.lc !== 1 || !Security.isValidDeviceId(data.did)) {
      this.onPairingError('Invalid response format.');
      return;
    }

    if (!this.activeSession) {
      this.onPairingError('No active pairing session.');
      return;
    }

    // Verify token
    if (!Security.safeCompare(data.tok, this.activeSession.pairingToken)) {
      this.onPairingError('Pairing token mismatch — possible tampering.');
      return;
    }

    // Apply the answer to the pending connection
    // We need to move the pending connection from '__pending__' to real device ID
    const pendingConn = this.connectionManager.getConnection('__pending__');
    if (pendingConn) {
      this.connectionManager.connections.delete('__pending__');
      pendingConn.remoteDeviceId = data.did;
      this.connectionManager.connections.set(data.did, pendingConn);
    }

    await this.connectionManager.applyAnswer(data.did, data.sdp);

    const trustedDevice = {
      deviceId:   data.did,
      deviceName: data.dn || 'Unknown Device',
      deviceType: data.dt || 'desktop',
      trustedAt:  Date.now(),
      lastSeen:   Date.now()
    };

    this.activeSession.stopExpiry();
    this.activeSession.status = PairingStatus.ACCEPTED;
    this.onPairingComplete(trustedDevice);
    this.activeSession = null;
  }

  /**
   * User accepted a pairing request (responder side).
   * Returns the response payload to share with initiator.
   */
  acceptRequest() {
    if (!this.activeSession) return null;
    const pending = this.activeSession.getPendingRequest();
    if (!pending) return null;

    const trustedDevice = {
      deviceId:   pending.deviceId,
      deviceName: pending.deviceName,
      deviceType: pending.deviceType,
      trustedAt:  Date.now(),
      lastSeen:   Date.now()
    };

    this.activeSession.status = PairingStatus.ACCEPTED;
    this.onPairingComplete(trustedDevice);

    const response = pending.responsePayload;
    this.activeSession = null;
    return response;
  }

  /**
   * User rejected a pairing request.
   */
  rejectRequest() {
    if (this.activeSession) {
      const pending = this.activeSession.getPendingRequest();
      if (pending) {
        this.connectionManager.disconnect(pending.deviceId);
      }
      this.activeSession.status = PairingStatus.REJECTED;
      this.activeSession = null;
    }
  }

  /**
   * Cancel the active pairing session.
   */
  cancelSession() {
    if (this.activeSession) {
      this.activeSession.destroy();
      this.activeSession = null;
    }
    // Clean up any pending WebRTC connection
    this.connectionManager.disconnect('__pending__');
  }

  get isActive() {
    return this.activeSession !== null;
  }
}
