# LAN Clipboard

> Securely share clipboard text between trusted devices on your local network — no cloud, no backend, no account.

---

## What Was Built

LAN Clipboard is a complete, production-quality, client-side-only web application that enables manual peer-to-peer clipboard sharing between trusted devices on the same local network. Every feature listed below is fully implemented and functional.

---

## Features

| Feature | Status |
|---|---|
| First-run device naming | Done |
| Cryptographically secure device ID (Web Crypto) | Done |
| Manual device pairing via QR code | Done |
| Manual device pairing via copy/paste connection packet | Done |
| Pairing code display (e.g. `7F4K-92MX`) | Done |
| Pairing approval workflow | Done |
| Pairing token expiry (10 minutes) | Done |
| WebRTC DataChannel peer-to-peer connection | Done |
| Clipboard read (browser Clipboard API) | Done |
| Clipboard send to selected trusted device | Done |
| Incoming clipboard display + copy | Done |
| Clipboard history (IndexedDB) | Done |
| History search | Done |
| History delete / clear all | Done |
| Trusted device management | Done |
| Device removal and disconnection | Done |
| Connection status indicators | Done |
| Keepalive ping/pong | Done |
| Structured message protocol with validation | Done |
| Malformed message rejection | Done |
| Oversized payload rejection (1 MB limit) | Done |
| Send confirmation (optional setting) | Done |
| Settings page | Done |
| Browser compatibility detection | Done |
| Secure context detection | Done |
| PWA manifest + service worker | Done |
| Offline-capable UI | Done |
| Responsive design (mobile / tablet / desktop) | Done |
| Dark color palette (exact brand colors) | Done |
| Phosphor Icons | Done |
| No emojis | Done |
| About & Privacy view | Done |

---

## Technology Stack

| Layer | Technology |
|---|---|
| UI | Vanilla HTML5, CSS3, JavaScript (ES modules) |
| Peer communication | WebRTC DataChannel |
| Signaling | Manual (QR code + copy/paste) — no server |
| Local persistence | IndexedDB (Storage module) |
| Security | Web Crypto API (crypto.getRandomValues, SHA-256) |
| QR generation | [qrcodejs@1.0.0](https://github.com/davidshimjs/qrcodejs) — client-side only |
| QR scanning | [jsQR@1.4.0](https://github.com/cozmo/jsQR) — client-side only |
| Icons | [Phosphor Icons@2.1.1](https://phosphoricons.com/) |
| Fonts | Cormorant Garamond (serif headings), Inter (UI/body) |
| PWA | Service Worker + Web App Manifest |
| Framework | None (no React, Vue, Angular) |
| Backend | None |

---

## Folder Structure

```
lan-clipboard/
├── index.html              Main application (first-run + full shell)
├── manifest.json           PWA manifest
├── sw.js                   Service Worker (static asset caching)
├── README.md
│
├── styles/
│   ├── main.scss           SCSS entry (imports all partials)
│   ├── compiled.css        Compiled output (served directly)
│   ├── _variables.scss     Color palette, typography, spacing tokens
│   ├── _reset.scss         CSS reset
│   ├── _typography.scss    Heading and text classes
│   ├── _layout.scss        Sidebar, topbar, content layout
│   ├── _components.scss    Buttons, cards, modals, toasts, badges
│   ├── _forms.scss         Input, toggle, range, code-entry styles
│   ├── _devices.scss       Device cards, pairing UI
│   ├── _clipboard.scss     Clipboard panel, history items, incoming card
│   └── _responsive.scss    Media queries
│
├── js/
│   ├── app.js              Main orchestrator — bootstrap, state, event wiring
│   ├── utils.js            Pure utility functions
│   ├── security.js         Web Crypto — device IDs, tokens, hashing
│   ├── storage.js          IndexedDB wrapper (devices, history, settings)
│   ├── settings.js         User preferences (persisted)
│   ├── protocol.js         Message format, factories, validation
│   ├── webrtc.js           RTCPeerConnection + DataChannel manager
│   ├── pairing.js          Pairing session lifecycle
│   ├── qr.js               QR generation and camera scanner
│   ├── clipboard.js        Clipboard API wrapper with fallback
│   ├── history.js          Clipboard history CRUD
│   ├── devices.js          Trusted device registry
│   └── ui.js               Toast, Modal, Router, DOM helpers
│
└── assets/
    └── icons/
        └── icon.svg        App icon
```

---

## Security Architecture

### Device Identity
Every browser installation generates a **128-bit cryptographically secure device ID** using `crypto.getRandomValues()`. This ID is stored locally and never shared beyond pairing.

### Pairing Tokens
- 128-bit pairing tokens generated with `crypto.getRandomValues()`
- Pairing codes are 8 characters from an unambiguous alphabet (no 0/O/1/I/L)
- **All tokens expire after 10 minutes**
- Constant-time string comparison used to prevent timing attacks

### No Math.random()
Security-sensitive values (device IDs, pairing tokens, message IDs) always use `crypto.getRandomValues()`.

### Data Isolation
- Clipboard content is **never** sent to any server
- Only devices that have completed the trust workflow can receive clipboard data
- Incoming messages from untrusted device IDs are silently rejected
- Every incoming message is validated against a strict protocol schema

### Transport
WebRTC DataChannels are encrypted by default using DTLS. WebRTC is not a guarantee of end-to-end authentication on its own, but combined with the pairing workflow (which requires physical proximity or a trusted channel to exchange offer/answer), the system provides a reasonable security posture for LAN use.

---

## Pairing Architecture

Because browsers cannot automatically discover devices on a LAN, pairing requires a **manual signaling exchange**:

```
Device A (Initiator)                Device B (Responder)
        |                                   |
 [Generate WebRTC Offer]                    |
 [Show QR / Copy offer payload]             |
        |-------- offer payload ----------->|
        |         (QR scan or paste)        |
        |                                [Create WebRTC Answer]
        |                                [Show pairing request]
        |                                [User approves]
        |<-------- answer payload ----------|
        |         (copy/paste)              |
 [Apply answer]                             |
        |<======= WebRTC DataChannel ======>|
        |      (direct, encrypted)          |
```

The offer payload is a compact JSON object containing:
- Protocol version
- Initiator device ID + name + type
- Pairing token (128-bit, expires in 10 min)
- Pairing code (8 chars, human-readable)
- WebRTC SDP offer (base64-encoded)
- Timestamp

The answer payload contains:
- Responder device ID + name + type
- Echo of the pairing token (proves the responder saw the real offer)
- WebRTC SDP answer (base64-encoded)

### QR Code
The full offer payload is encoded into a QR code using qrcodejs. If the payload is too large for a reliable QR code (> ~2.8 KB, which can happen with many ICE candidates), the UI automatically falls back to the copy/paste method and explains why.

---

## Message Protocol

Every WebRTC DataChannel message uses a typed JSON protocol:

```json
{
  "type": "clipboard",
  "version": 1,
  "messageId": "a1b2c3d4e5f6",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "sourceDeviceId": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
  "sourceDeviceName": "Vikram Laptop",
  "contentType": "text/plain",
  "text": "Hello from Laptop!",
  "byteSize": 18
}
```

Supported message types:
- `pairing-offer`, `pairing-ack`, `pairing-accept`, `pairing-reject`
- `clipboard`
- `device-info`
- `ping`, `pong`
- `disconnect`
- `error`

Every incoming message is validated:
- JSON parse check
- Size limit check (1 MB default)
- Required field presence
- Protocol version check
- Message type whitelist
- Device ID format check
- Type-specific field checks

---

## Clipboard Limitations

Due to browser security restrictions:

1. **Clipboard access requires a secure context.** The app must be served over HTTPS or accessed via `localhost`. On insecure origins, `navigator.clipboard` is unavailable and a warning is shown.

2. **There is no automatic clipboard monitoring.** Browsers do not allow background clipboard reading. The user must click "Read Clipboard" to load content.

3. **Permissions may be required.** Some browsers require the user to grant clipboard-read permission explicitly. If denied, a clear error is shown.

4. **No clipboard file sharing.** Only text is supported (the Web Clipboard API `readText`/`writeText`). Binary content, images, and rich text are not supported.

5. **1 MB default size limit.** Configurable in Settings (0.1 MB – 10 MB).

---

## Browser Compatibility

| Feature | Required? | Notes |
|---|---|---|
| WebRTC | Yes | Chrome 56+, Firefox 44+, Safari 11+, Edge 79+ |
| Clipboard API | Yes | Chrome 66+, Firefox 63+, Safari 13.1+. Requires HTTPS. |
| Web Crypto API | Yes | All modern browsers |
| IndexedDB | Yes | All modern browsers |
| ES Modules | Yes | Chrome 61+, Firefox 60+, Safari 10.1+ |
| Service Worker | Optional | Progressive enhancement |
| getUserMedia (camera) | Optional | QR scan only. Requires HTTPS + permission. |

The app detects missing APIs and shows informative warnings rather than silently failing.

---

## Local Storage Model

All data is stored in a single **IndexedDB** database named `lan-clipboard-db`:

| Store | Key | Contents |
|---|---|---|
| `settings` | key (string) | App settings + device identity |
| `devices` | deviceId | Trusted device records |
| `history` | id | Clipboard history items |

Clipboard history items:
```json
{
  "id": "abc123def456",
  "text": "clipboard content",
  "timestamp": 1705312200000,
  "direction": "sent",
  "sourceDevice": "Android Phone",
  "size": 17
}
```

History is trimmed to 200 items automatically. All data is local — nothing is synced to a server.

---

## PWA Information

The app includes:
- `manifest.json` — allows "Add to Home Screen" on mobile
- `sw.js` — service worker that caches static assets for offline use

**Important:** The service worker only caches static assets (HTML, CSS, JS). It does **not** perform any clipboard monitoring or background data transfer.

---

## How to Run

### Option A: Direct file access (simplest)
Open `index.html` directly in a browser.

> Note: Clipboard API may not work on `file://` origins in some browsers. Use a local server for full functionality.

### Option B: Local HTTP server (recommended)
```bash
# Python
python3 -m http.server 8080

# Node.js (npx)
npx serve .

# Node.js (http-server)
npx http-server . -p 8080
```

Then open `http://localhost:8080` in your browser.

> For clipboard access on local network devices, serve over HTTPS (e.g., using mkcert).

---

## How to Test Two Devices

1. **Start a local server** on Device A (e.g., `python3 -m http.server 8080`)
2. **Find Device A's local IP** (e.g., `192.168.1.100`)
3. **Open the app on Device A** at `http://localhost:8080`
4. **Open the app on Device B** at `http://192.168.1.100:8080`
5. **Name each device** on first run
6. **On Device A:** click "Pair Device" — a QR code and pairing code appears
7. **On Device B:** click "Pair Device" → "Enter Connection Data" → paste or scan Device A's data
8. **On Device A:** paste Device B's response to complete pairing
9. **Both devices show "Connected"**
10. **On Device A:** click "Read Clipboard", select Device B, click "Send"
11. **On Device B:** the incoming clipboard appears — click "Copy"

> For cross-device clipboard testing: the `localhost` HTTPS exemption does not extend to other devices. For full clipboard access on remote devices, serve over HTTPS.

---

## Known Browser Limitations

1. **No automatic discovery:** Browsers cannot enumerate LAN devices. Pairing is always manual.
2. **No background clipboard sync:** `readText()` requires a user gesture; periodic polling is not implemented (and would violate browser security policies).
3. **File:// origin:** Clipboard API is blocked on `file://` origins in Chromium. Use a local server.
4. **Clipboard permission dialog:** On some browsers, a permission prompt appears the first time. If denied, show an error explaining how to re-enable.
5. **Camera permission for QR:** Camera access requires HTTPS on most browsers and may require explicit permission grant.
6. **Large QR codes:** The full WebRTC offer SDP can exceed QR code size limits. The app detects this and offers copy/paste as fallback.
7. **WebRTC on mobile browsers:** WebRTC works in mobile Chrome and Safari. Some older mobile browsers may have limited support.
8. **ICE connectivity:** On networks with strict firewalls, WebRTC host candidates (LAN IP) are used. STUN servers are included to help with NAT but no TURN server is provided (no relay fallback).

---

## Privacy Model

- **No account, no login, no email**
- **No data sent to external servers** — ever
- **Clipboard content travels only between your paired devices** via WebRTC
- **All history is stored locally** in your browser's IndexedDB
- **Pairing data contains only connection metadata** — not clipboard content
- **You can delete all local data** from Settings → Reset App

---

## Troubleshooting

**"Clipboard access was denied"**
- Make sure you're on HTTPS or localhost
- Grant clipboard permission in your browser settings

**"Peer-to-peer communication is not available"**
- Use a modern browser (Chrome 80+, Firefox 75+, Safari 14+)

**"Pairing code expired"**
- Click "Pair Device" again to generate a fresh code

**"Connection failed"**
- Both devices must be on the same network
- Try generating a new pairing session
- Check that your browser/OS firewall doesn't block WebRTC

**QR code says "too large"**
- Use the copy/paste method instead — click "Copy pairing data" on one device and paste on the other
