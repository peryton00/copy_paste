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

  _videoEl:     null,
  _streamRef:   null,
  _scanInterval: null,
  _canvas:      null,
  _ctx:         null,
  _active:      false,

  /**
   * Start QR scanner using device camera.
   * @param {HTMLElement} videoContainer - element to inject video into
   * @param {Function}    onResult(text) - called when a QR code is detected
   * @param {Function}    onError(err)   - called on camera/scan error
   */
  async startScanner(videoContainer, onResult, onError) {
    if (this._active) this.stopScanner();

    if (!navigator.mediaDevices?.getUserMedia) {
      onError('Camera access is not available in this browser or context.');
      return;
    }

    if (!window.jsQR) {
      onError('QR scanning library not loaded.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }
      });

      this._streamRef = stream;
      this._active = true;

      const video = document.createElement('video');
      video.setAttribute('autoplay', '');
      video.setAttribute('muted', '');
      video.setAttribute('playsinline', '');
      video.style.width = '100%';
      video.style.height = '100%';
      video.style.objectFit = 'cover';
      video.srcObject = stream;
      this._videoEl = video;

      videoContainer.innerHTML = '';
      videoContainer.appendChild(video);

      await video.play();

      // Canvas for frame extraction
      this._canvas = document.createElement('canvas');
      this._ctx = this._canvas.getContext('2d');

      this._scanInterval = setInterval(() => {
        if (!this._active || video.readyState !== video.HAVE_ENOUGH_DATA) return;

        const w = video.videoWidth;
        const h = video.videoHeight;
        if (!w || !h) return;

        this._canvas.width  = w;
        this._canvas.height = h;
        this._ctx.drawImage(video, 0, 0, w, h);

        const imageData = this._ctx.getImageData(0, 0, w, h);
        const code = window.jsQR(imageData.data, w, h, {
          inversionAttempts: 'dontInvert'
        });

        if (code && code.data) {
          this.stopScanner();
          onResult(code.data);
        }
      }, 250);

    } catch (e) {
      this._active = false;
      const msg = e.name === 'NotAllowedError'
        ? 'Camera permission was denied.'
        : e.name === 'NotFoundError'
          ? 'No camera found on this device.'
          : `Camera error: ${e.message}`;
      onError(msg);
    }
  },

  /**
   * Stop the scanner and release camera
   */
  stopScanner() {
    this._active = false;

    clearInterval(this._scanInterval);
    this._scanInterval = null;

    if (this._streamRef) {
      this._streamRef.getTracks().forEach(t => t.stop());
      this._streamRef = null;
    }

    if (this._videoEl) {
      this._videoEl.srcObject = null;
      this._videoEl = null;
    }

    this._canvas = null;
    this._ctx    = null;
  },

  /**
   * Check if camera access is likely available
   */
  isCameraAvailable() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }
};
