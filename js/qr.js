/**
 * LAN CLIPBOARD — QR Code Module
 * Client-side QR generation using qrcodejs
 * Client-side QR scanning using jsQR via camera
 */

'use strict';

export const QR = {

  /**
   * Generate a QR code into a container element.
   * Uses the globally loaded QRCode library.
   * @param {HTMLElement} container
   * @param {string}      text
   * @param {object}      opts
   */
  generate(container, text, opts = {}) {
    if (!window.QRCode) {
      container.innerHTML = '<p style="color:#940417;font-size:13px;text-align:center">QR library not loaded</p>';
      return;
    }

    container.innerHTML = '';

    try {
      const correctLevel = window.QRCode.CorrectLevel ? window.QRCode.CorrectLevel.L : 1;
      new window.QRCode(container, {
        text,
        width:          opts.width       || 200,
        height:         opts.height      || 200,
        colorDark:      opts.colorDark   || '#180E12',
        colorLight:     opts.colorLight  || '#E4DCCB',
        correctLevel:   correctLevel,
        quietZone:      10,
        quietZoneColor: opts.colorLight  || '#E4DCCB'
      });
    } catch (e) {
      container.innerHTML = `
        <div style="text-align:center;padding:1rem;">
          <p style="color:#B46595;font-size:13px;margin-bottom:0.5rem;">Connection data ready.</p>
          <p style="font-size:12px;color:var(--text-secondary);">Use the <strong>Copy pairing data</strong> button below to connect.</p>
        </div>
      `;
      console.error('[QR] Generation error:', e);
    }
  },

  // ---- Scanner ----

  _videoEl:      null,
  _streamRef:    null,
  _scanInterval: null,
  _canvas:       null,
  _ctx:          null,
  _active:       false,
  _starting:     false,

  /**
   * Start QR scanner using device camera.
   * @param {HTMLVideoElement} videoEl
   * @param {Function}         onResult(text) - called when a QR code is detected
   * @param {Function}         onError(err)   - called on camera/scan error
   */
  async startScanner(videoEl, onResult, onError) {
    // Always stop any previous session first (clears _active, _starting, stream)
    this.stopScanner();

    if (!navigator.mediaDevices?.getUserMedia) {
      const msg = 'Camera not available. Use HTTPS or localhost.';
      console.error('[QR]', msg);
      if (onError) onError(msg);
      return;
    }

    if (!window.jsQR) {
      const msg = 'QR library (jsQR) not loaded.';
      console.error('[QR]', msg);
      if (onError) onError(msg);
      return;
    }

    this._starting = true;

    try {
      console.log('[QR] Requesting camera…');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
      });

      console.log('[QR] Camera granted, attaching stream…');
      this._streamRef = stream;
      this._active    = true;
      this._videoEl   = videoEl;

      videoEl.muted    = true;
      videoEl.srcObject = stream;
      videoEl.style.display = 'block';

      // Wait for video to be playable (canplay is more reliable than loadedmetadata)
      await new Promise(resolve => {
        if (videoEl.readyState >= 3) { resolve(); return; }
        const done = () => { videoEl.removeEventListener('canplay', done); resolve(); };
        videoEl.addEventListener('canplay', done);
        setTimeout(resolve, 800); // fallback
      });

      await videoEl.play().catch(e => console.warn('[QR] play():', e));
      console.log('[QR] Video playing, readyState:', videoEl.readyState);

      this._canvas = document.createElement('canvas');
      this._ctx    = this._canvas.getContext('2d', { willReadFrequently: true });

      this._scanInterval = setInterval(() => {
        if (!this._active || !this._videoEl || videoEl.readyState < 2) return;
        const code = this.scanCurrentFrame();
        if (code && onResult) { this.stopScanner(); onResult(code); }
      }, 250);

    } catch (e) {
      console.error('[QR] Camera error:', e);
      this.stopScanner();
      const msg = e.name === 'NotAllowedError'
        ? 'Camera permission denied. Allow camera access in your browser settings.'
        : e.name === 'NotFoundError'
          ? 'No camera found on this device.'
          : `Camera error: ${e.message}`;
      if (onError) onError(msg);
    } finally {
      this._starting = false;
    }
  },

  scanCurrentFrame() {
    if (!this._videoEl || this._videoEl.readyState < 2 || !this._ctx) return null;
    const v = this._videoEl;
    const w = v.videoWidth || 640;
    const h = v.videoHeight || 480;
    if (!w || !h) return null;

    this._canvas.width = w;
    this._canvas.height = h;
    this._ctx.drawImage(v, 0, 0, w, h);

    try {
      const imgData = this._ctx.getImageData(0, 0, w, h);
      const code = window.jsQR(imgData.data, w, h, { inversionAttempts: 'dontInvert' });
      return code && code.data ? code.data : null;
    } catch {
      return null;
    }
  },

  /**
   * Stop the scanner and release camera
   */
  stopScanner() {
    this._active = false;
    this._starting = false;

    if (this._scanInterval) {
      clearInterval(this._scanInterval);
      this._scanInterval = null;
    }

    if (this._streamRef) {
      try {
        this._streamRef.getTracks().forEach(t => t.stop());
      } catch (e) { /* ignore */ }
      this._streamRef = null;
    }

    if (this._videoEl) {
      try {
        this._videoEl.srcObject = null;
        this._videoEl.style.display = 'none';
      } catch (e) { /* ignore */ }
      this._videoEl = null;
    }

    this._canvas = null;
    this._ctx = null;
  },

  /**
   * Check if camera access is likely available
   */
  isCameraAvailable() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }
};
