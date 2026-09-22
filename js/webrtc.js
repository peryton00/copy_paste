/**
 * LAN CLIPBOARD — WebRTC Connection Manager
 * Manages RTCPeerConnection, DataChannel, ICE negotiation,
 * ping/pong keepalive, and message delivery.
 */

'use strict';

import { Protocol, MessageType } from './protocol.js';

const ICE_SERVERS = [
  // STUN servers help with NAT traversal even on LAN
  // For purely local networks, ICE will use host candidates
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

const DC_LABEL          = 'lan-clipboard';
const PING_INTERVAL_MS  = 8000;
const PONG_TIMEOUT_MS   = 5000;
const RECONNECT_DELAY_MS= 3000;
const MAX_RECONNECT     = 5;

export const ConnectionStatus = Object.freeze({
  NEW:          'new',
  CONNECTING:   'connecting',
  CONNECTED:    'connected',
  DISCONNECTED: 'disconnected',
  FAILED:       'error',
  CLOSED:       'closed'
});

/**
 * Represents one peer connection to a trusted device.
 */
export class PeerConnection {
  constructor({ localDeviceId, remoteDeviceId, onMessage, onStatusChange, onError }) {
    this.localDeviceId   = localDeviceId;
    this.remoteDeviceId  = remoteDeviceId;
    this.onMessage       = onMessage       || (() => {});
    this.onStatusChange  = onStatusChange  || (() => {});
    this.onError         = onError         || (() => {});

    this.pc              = null;
    this.dc              = null;
    this.status          = ConnectionStatus.NEW;
    this.isInitiator     = false;
    this.pendingCandidates = [];

    this._pingTimer      = null;
    this._pongTimer      = null;
    this._reconnectCount = 0;
    this._closed         = false;
    this._lastSeen       = null;
  }

  // ---- Status ----

  _setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.onStatusChange(this.remoteDeviceId, status);
  }

  // ---- Lifecycle ----

  /**
   * Create the RTCPeerConnection and optionally create a DataChannel (initiator).
   */
  _createPC() {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = e => {
      // ICE candidates are bundled into the SDP for manual signaling
      // No additional handling needed here — callers read pc.localDescription
      // after gathering is complete
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') {
        this._setStatus(ConnectionStatus.FAILED);
        this._handleDisconnect();
      } else if (pc.iceConnectionState === 'disconnected') {
        this._setStatus(ConnectionStatus.DISCONNECTED);
      } else if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        // Confirmed at DataChannel level below
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        this._setStatus(ConnectionStatus.CONNECTED);
      } else if (pc.connectionState === 'failed') {
        this._setStatus(ConnectionStatus.FAILED);
        this._handleDisconnect();
      } else if (pc.connectionState === 'disconnected') {
        this._setStatus(ConnectionStatus.DISCONNECTED);
      }
    };

    pc.ondatachannel = e => {
      // Responder receives the data channel here
      this._setupDataChannel(e.channel);
    };

    this.pc = pc;
    return pc;
  }

  /**
   * Set up the DataChannel and its event handlers.
   */
  _setupDataChannel(dc) {
    this.dc = dc;
    dc.binaryType = 'arraybuffer';

    dc.onopen = () => {
      this._setStatus(ConnectionStatus.CONNECTED);
      this._reconnectCount = 0;
      this._startPing();
    };

    dc.onclose = () => {
      this._stopPing();
      if (!this._closed) {
        this._setStatus(ConnectionStatus.DISCONNECTED);
      }
    };

    dc.onerror = e => {
      this.onError(this.remoteDeviceId, `DataChannel error: ${e.error?.message || 'unknown'}`);
    };

    dc.onmessage = e => {
      this._lastSeen = Date.now();
      const result = Protocol.parse(e.data);
      if (!result.ok) {
        console.warn(`[WebRTC] Invalid message from ${this.remoteDeviceId}:`, result.error);
        return;
      }
      const msg = result.message;

      // Handle internal protocol messages
      if (msg.type === MessageType.PING) {
        this._sendRaw(Protocol.serialize(Protocol.createPong(this.localDeviceId)));
        return;
      }
      if (msg.type === MessageType.PONG) {
        clearTimeout(this._pongTimer);
        return;
      }
      if (msg.type === MessageType.DISCONNECT) {
        this._setStatus(ConnectionStatus.DISCONNECTED);
        this._cleanup(false);
        return;
      }

      this.onMessage(this.remoteDeviceId, msg);
    };
  }

  // ---- Initiator flow ----

  /**
   * Create an offer (called by the initiator).
   * Returns the full offer SDP (with gathered ICE candidates) as a base64 string.
   */
  async createOffer() {
    this._createPC();
    this.isInitiator = true;
    this._setStatus(ConnectionStatus.CONNECTING);

    // Create data channel before generating offer
    const dc = this.pc.createDataChannel(DC_LABEL, {
      ordered: true,
      protocol: 'lan-clipboard-v1'
    });
    this._setupDataChannel(dc);

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    // Wait for ICE gathering to complete
    await this._waitForIceGathering();

    return this._encodeSDP(this.pc.localDescription);
  }

  /**
   * Receive and apply the answer from the responder.
   * @param {string} encodedAnswer - base64 answer SDP
   */
  async applyAnswer(encodedAnswer) {
    const sdp = this._decodeSDP(encodedAnswer);
    await this.pc.setRemoteDescription(sdp);
  }

  // ---- Responder flow ----

  /**
   * Receive an offer and create an answer.
   * @param {string} encodedOffer - base64 offer SDP
   * Returns the encoded answer SDP.
   */
  async createAnswer(encodedOffer) {
    this._createPC();
    this.isInitiator = false;
    this._setStatus(ConnectionStatus.CONNECTING);

    const sdp = this._decodeSDP(encodedOffer);
    await this.pc.setRemoteDescription(sdp);

    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);

    await this._waitForIceGathering();

    return this._encodeSDP(this.pc.localDescription);
  }

  // ---- Helpers ----

  _waitForIceGathering() {
    return new Promise(resolve => {
      if (this.pc.iceGatheringState === 'complete') {
        resolve();
        return;
      }
      const check = () => {
        if (this.pc.iceGatheringState === 'complete') {
          this.pc.removeEventListener('icegatheringstatechange', check);
          resolve();
        }
      };
      this.pc.addEventListener('icegatheringstatechange', check);

      // Safety timeout — resolve after 8s even if not complete
      setTimeout(resolve, 8000);
    });
  }

  _encodeSDP(sdpObj) {
    return btoa(JSON.stringify({ type: sdpObj.type, sdp: sdpObj.sdp }));
  }

  _decodeSDP(encoded) {
    try {
      return JSON.parse(atob(encoded));
    } catch {
      throw new Error('Invalid SDP encoding');
    }
  }

  // ---- Messaging ----

  _sendRaw(data) {
    if (this.dc && this.dc.readyState === 'open') {
      this.dc.send(data);
      return true;
    }
    return false;
  }

  /**
   * Send a protocol message to the remote peer.
   */
  send(msg) {
    return this._sendRaw(Protocol.serialize(msg));
  }

  // ---- Keepalive ----

  _startPing() {
    this._pingTimer = setInterval(() => {
      const sent = this._sendRaw(
        Protocol.serialize(Protocol.createPing(this.localDeviceId))
      );
      if (!sent) {
        this._stopPing();
        return;
      }

      // Pong timeout
      this._pongTimer = setTimeout(() => {
        this._handleDisconnect();
      }, PONG_TIMEOUT_MS);
    }, PING_INTERVAL_MS);
  }

  _stopPing() {
    clearInterval(this._pingTimer);
    clearTimeout(this._pongTimer);
    this._pingTimer = null;
    this._pongTimer = null;
  }

  // ---- Disconnect handling ----

  _handleDisconnect() {
    this._stopPing();
    if (this._closed) return;
    this._setStatus(ConnectionStatus.DISCONNECTED);
  }

  // ---- Cleanup ----

  _cleanup(notify = true) {
    this._closed = true;
    this._stopPing();

    if (notify && this.dc && this.dc.readyState === 'open') {
      try {
        this._sendRaw(Protocol.serialize(Protocol.createDisconnect(this.localDeviceId)));
      } catch { /* ignore */ }
    }

    if (this.dc) {
      try { this.dc.close(); } catch { /* ignore */ }
      this.dc = null;
    }

    if (this.pc) {
      try { this.pc.close(); } catch { /* ignore */ }
      this.pc = null;
    }
  }

  /**
   * Close this connection gracefully.
   */
  close() {
    this._setStatus(ConnectionStatus.CLOSED);
    this._cleanup(true);
  }

  /**
   * Get last seen timestamp
   */
  get lastSeen() {
    return this._lastSeen;
  }

  /**
   * Check if the data channel is ready to send
   */
  get isReady() {
    return this.dc && this.dc.readyState === 'open';
  }
}

/**
 * Connection Manager — singleton that manages all peer connections
 */
export class ConnectionManager {
  constructor() {
    this.connections = new Map(); // remoteDeviceId -> PeerConnection
    this.localDeviceId = null;
    this.onMessage     = null;
    this.onStatusChange= null;
    this.onError       = null;
  }

  init({ localDeviceId, onMessage, onStatusChange, onError }) {
    this.localDeviceId  = localDeviceId;
    this.onMessage      = onMessage      || (() => {});
    this.onStatusChange = onStatusChange || (() => {});
    this.onError        = onError        || (() => {});
  }

  _makePeer(remoteDeviceId) {
    return new PeerConnection({
      localDeviceId:  this.localDeviceId,
      remoteDeviceId,
      onMessage:      (id, msg)    => this.onMessage(id, msg),
      onStatusChange: (id, status) => this.onStatusChange(id, status),
      onError:        (id, err)    => this.onError(id, err)
    });
  }

  /**
   * Create an offer for a new peer (initiator side).
   * Returns { peer, encodedOffer }
   */
  async createOffer(remoteDeviceId) {
    const peer = this._makePeer(remoteDeviceId);
    this.connections.set(remoteDeviceId, peer);
    const encodedOffer = await peer.createOffer();
    return { peer, encodedOffer };
  }

  /**
   * Create an answer given an offer (responder side).
   * Returns { peer, encodedAnswer }
   */
  async createAnswer(remoteDeviceId, encodedOffer) {
    const peer = this._makePeer(remoteDeviceId);
    this.connections.set(remoteDeviceId, peer);
    const encodedAnswer = await peer.createAnswer(encodedOffer);
    return { peer, encodedAnswer };
  }

  /**
   * Apply an answer to an existing peer connection.
   */
  async applyAnswer(remoteDeviceId, encodedAnswer) {
    const peer = this.connections.get(remoteDeviceId);
    if (!peer) throw new Error(`No pending connection for ${remoteDeviceId}`);
    await peer.applyAnswer(encodedAnswer);
  }

  /**
   * Send a message to a specific peer.
   */
  sendTo(remoteDeviceId, msg) {
    const peer = this.connections.get(remoteDeviceId);
    if (!peer) return false;
    return peer.send(msg);
  }

  /**
   * Get connection by remoteDeviceId
   */
  getConnection(remoteDeviceId) {
    return this.connections.get(remoteDeviceId);
  }

  /**
   * Get all connections
   */
  getAllConnections() {
    return [...this.connections.values()];
  }

  /**
   * Disconnect a specific peer
   */
  disconnect(remoteDeviceId) {
    const peer = this.connections.get(remoteDeviceId);
    if (peer) {
      peer.close();
      this.connections.delete(remoteDeviceId);
    }
  }

  /**
   * Disconnect all peers
   */
  disconnectAll() {
    this.connections.forEach(peer => peer.close());
    this.connections.clear();
  }

  /**
   * Check WebRTC availability
   */
  static isSupported() {
    return !!(
      typeof RTCPeerConnection !== 'undefined' &&
      typeof RTCPeerConnection.prototype.createDataChannel !== 'undefined'
    );
  }
}
