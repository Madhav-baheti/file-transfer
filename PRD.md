# PRD: Encrypted Peer-to-Peer File & Text Transfer

**Author:** Madhav | **Status:** Draft v0.1 | **Date:** 9 Oct 2026

## Status (as built)

- QR-link pairing and six-digit numeric session codes are implemented.
- Code-only pairing requires comparing an eight-digit numeric verification code, not words.
- The handshake uses commit-then-reveal ephemeral ECDH bound to DTLS fingerprints; PAKE is not implemented.
- Application messages pass through `SecureTransport` before reaching the raw WebRTC data channel.
- File transfer uses chunks, receiver acknowledgements, and a 16 MiB sender in-flight window.
- The receiver checks chunk order, byte totals, and the final SHA-256 digest.
- Files are offered individually; an ordered multi-file queue is implemented in the web app.
- The web app and signaling service are deployed on Render's free plan using `render.yaml`.
- PWA/share-target and dark-theme code exists in the repository; real-device behavior is not claimed verified.
- No TURN relay is configured; interrupted-transfer resume and CSP are not implemented.

## 1. Overview

A web app that moves files and text directly between two devices over an end-to-end encrypted WebRTC data channel. Devices pair by opening a QR link or typing a short code. The signaling service relays connection setup and holds short-lived session state; it does not receive file contents or chat messages.

**One-line pitch:** Open the site on two devices, scan or type a code, drop a file. It goes straight from one to the other, and nobody in the middle can read it.

## 2. Problem Statement

Sending a file from a phone to a laptop (or to a friend's device) today means one of: emailing it to yourself, uploading to WhatsApp/Drive/WeTransfer, or using a cable. All of these route data through a third party's servers, add friction, compress or limit files, and leave copies behind. Existing P2P tools (AirDrop, Nearby Share) are locked to ecosystems; browser tools like Snapdrop depend on being on the same network and offer weak pairing security.

## 3. Goals and Non-Goals

### Goals

- Transfer files and text between any two devices with a modern browser, with no install and no account.
- End-to-end encryption by design: the server cannot read content even if it is malicious or compromised.
- Pairing in under 15 seconds via QR or short code.
- Works across different networks (not only the same Wi-Fi).
- Clean enough codebase and write-up to be a strong GitHub and resume project.

### Non-Goals (v1)

- No user accounts, login, or cloud storage of any kind.
- No group or multi-peer rooms (1-to-1 only).
- No offline delivery (both devices must be online at the same time).
- No native mobile or desktop apps (PWA only).
- No anonymity against network observers (IP addresses are visible to the peer and to STUN/TURN).

## 4. Target Users

| Persona | Need |
|---|---|
| Student (primary) | Move notes, PDFs, code and screenshots between phone, laptop, and college lab PCs without logging into personal accounts. |
| Privacy-conscious user | Share a sensitive document without it landing on a company server. |
| Cross-ecosystem pair | Android to Windows, iPhone to Linux, where no built-in tool works. |

## 5. Key User Flows

### 5.1 Pair by QR code

1. Device A opens the site and taps **Create session**. A QR code and a short code are displayed.
2. Device B scans the QR with its camera, which opens the site with the session secret in the URL fragment.
3. The QR secret participates in the handshake; QR pairing does not require comparing the numeric verification code.
4. Connection status turns to **Connected**.

### 5.2 Pair by short code

1. Device A shows a six-digit rendezvous code such as `482193`.
2. Device B opens the site, chooses **Join**, and types the code.
3. Both users compare and confirm the eight-digit numeric verification code shown on their devices.

### 5.3 Send a file or text

1. Either side drags a file onto the page (or picks one, or pastes text).
2. Receiver sees filename, size, and an **Accept / Decline** prompt.
3. Transfer begins with a progress bar, speed, and ETA.
4. Receiver gets a download; both sides can send more until the session is closed.

### 5.4 End session

Either side taps **Disconnect** to close the connection and clear its in-memory keys. The signaling server removes its session entry after its configured TTL (five minutes by default); expiry does not itself close an established WebRTC data channel.

## 6. Functional Requirements

### P0: Must have (MVP)

| ID | Requirement |
|---|---|
| F1 | Create a session and display a QR code plus a human-readable short code. |
| F2 | Join a session by scanning the QR or entering the code. |
| F3 | Establish a direct browser-to-browser connection using WebRTC data channels. |
| F4 | Send files in chunks; receive by writing through the File System Access API where available or by in-memory Blob fallback, which is capped at 2 GiB. Large-file performance is not claimed as verified. |
| F5 | Send and receive plain text snippets. |
| F6 | Receiver must explicitly accept an incoming file before any bytes are saved. |
| F7 | Progress, speed, and cancel controls for each transfer. |
| F8 | Signaling session entries are single-use and expire after the configured TTL (five minutes by default, measured from creation). |
| F9 | Clear connection states: waiting, connecting, connected, failed, closed. |

### P1: Should have

| ID | Requirement |
|---|---|
| F10 | Multiple files in one transfer, queued. |
| F11 | Eight-digit numeric short authentication string shown on both devices; code-only users must compare and confirm it. |
| F12 | Integrity check: SHA-256 of each file verified on the receiver. |
| F13 | PWA manifest, service-worker, and share-target code exists; installation and share-target behavior require device validation. |
| F14 | Resume an interrupted transfer within the same session (not implemented). |
| F15 | TURN relay fallback when direct connection is impossible (credential-generation code exists, but no relay is configured). |

### P2: Nice to have

- Folder transfer as a zip stream.
- Optional passphrase on top of the code for high-security sessions.
- Localization. Dark mode is implemented.
- Clipboard sync mode.

## 7. Security and Privacy Requirements

This is the core of the product, so it gets its own section.

1. **No file contents on the signaling server.** The server relays connection-setup messages (SDP offers/answers, ICE candidates) and holds short-lived session state; file bytes travel over the WebRTC data channel.
2. **Pairing inputs.** The QR code carries a random secret in the URL fragment (`#...`), which browsers do not send as part of an HTTP request. The six-digit typed code is a rendezvous identifier, not a PAKE credential; code-only pairing relies on users comparing the eight-digit verification code.
3. **Layered encryption.** WebRTC encrypts the data channel with DTLS. Application messages are also encrypted with AES-256-GCM using keys derived from ephemeral ECDH and bound to DTLS fingerprints, with the QR secret included when present. PAKE is not implemented.
4. **Short-lived and single-use sessions.** Session codes are single-use, signaling entries expire after the configured TTL (five minutes by default), and create/join attempts are rate-limited per client address.
5. **Ephemeral keys.** Fresh keys per session; nothing persisted to disk or localStorage. This gives forward secrecy at the session level.
6. **No analytics feature.** The signaling server necessarily receives client network addresses to handle connections and rate limits; it does not receive file contents.
7. **Transparent threat model.** Publish what the app protects against and what it does not (see Section 13).

## 8. Recommended Technical Approach

My recommendation for v1, with reasons:

| Layer | Choice | Why |
|---|---|---|
| Transport | WebRTC `RTCDataChannel` | Direct browser-to-browser, NAT traversal built in, no relay of data in the common case. |
| Signaling | Small Node.js server using WebSockets (single process, in-memory sessions) | Easy to build and host free; stateless apart from short-lived session entries. |
| NAT traversal | Public STUN; TURN credential-generation code exists, but no relay is configured | Direct connections may fail on restrictive networks. |
| Pairing crypto | Ephemeral ECDH bound to DTLS fingerprints; random 128-bit secret for QR; numeric verification for code-only pairing | PAKE for the short code is not implemented. |
| Payload crypto | Web Crypto AES-GCM with per-chunk nonces | Native, fast, audited primitives. |
| Frontend | React + Vite; PWA manifest and service-worker code | Install and share-target behavior still need device validation. |
| File handling | File System Access API where available; in-memory Blob fallback capped at 2 GiB | The fallback requires memory proportional to file size. |
| Hosting | Static frontend and Node signaling service on Render's free plan (`render.yaml`) | The signaling host may sleep when idle. |

**Why WebRTC over a custom TCP/WebSocket relay:** a relay means the server carries the bytes, which defeats the "no middleman" promise and costs bandwidth. WebRTC keeps the data path peer to peer.

**Chunking:** 16 KB chunks (the safe cross-browser data channel message size), with backpressure using `bufferedAmountLowThreshold` so the sender never overruns the channel.

## 9. High-Level Architecture

- **Client A and Client B:** browsers running the same web app.
- **Signaling server:** creates a session ID, relays handshake messages between exactly two clients, then forgets the session.
- **STUN:** helps clients discover direct routes. TURN credential-generation code exists, but no TURN relay is currently configured.
- **Data path:** after the handshake, all content flows over the encrypted data channel directly between A and B.

```
 Device A                                   Device B
    |                                          |
    |-- 1. create session ------> Signaling <--|-- 2. join (QR / code)
    |<-- 3. SDP + ICE exchange (no content) -->|
    |                                          |
    |====== 4. encrypted WebRTC data channel ==|
    |            direct via STUN               |
```

## 10. Non-Functional Requirements

| Area | Target |
|---|---|
| Pairing time | Under 15 seconds from opening the site to connected, on a normal connection. |
| Throughput | Within 70% of the available link speed on a LAN; usable (above 2 MB/s) across the internet when direct. |
| Memory | Constant memory use regardless of file size (streaming). |
| Browser support | Latest Chrome, Edge, Firefox, Safari (iOS 16+), and Chrome on Android. |
| Availability | Signaling server 99% (best effort for a student project). |
| Accessibility | Keyboard operable, readable contrast, QR alternative via typed code. |
| Mobile | Fully usable at 360 px width; transfers continue while the screen is on. |

## 11. Success Metrics

Since there is no tracking, metrics are measured in testing and through opt-in feedback rather than analytics.

- Pairing success rate in test runs across at least 10 device and network combinations: above 95%.
- Median time to first byte after scan: under 10 seconds.
- A 1 GB file transfers successfully and the hash matches in 100% of test runs.
- Zero plaintext content or filenames visible in server logs (verified by inspection).
- Project outcomes: public GitHub repository with a README, architecture diagram, and threat model; live demo link.

## 12. Milestones

| Phase | Scope | Rough timing |
|---|---|---|
| 0. Research | Learn WebRTC data channels, ICE/STUN/TURN, Web Crypto; skim the CPace/SPAKE2 idea. | Week 1 |
| 1. Proof of concept | Two tabs connect through a signaling server and exchange text. | Week 2 |
| 2. File transfer | Chunking, backpressure, acknowledgements, progress, accept/decline, and hash verification. | Weeks 3-4 |
| 3. Pairing and crypto | QR-link and short-code flows, commit-then-reveal ECDH, app-layer encryption, numeric verification code; PAKE not implemented. | Weeks 5-6 |
| 4. Polish and PWA | UI, error states, PWA manifest/service worker, share target, dark theme; TURN relay not configured. | Weeks 7-8 |
| 5. Launch | Threat model write-up, README, deployment, demo video, resume entry. | Week 9 |

## 13. Threat Model Summary

| Threat | Mitigation |
|---|---|
| Malicious or compromised signaling server | Keys derived from the pairing secret; DTLS fingerprints bound into the key; server cannot decrypt or silently substitute an endpoint. |
| Attacker guessing the short code | No PAKE is implemented. Single-use codes, session-entry expiry, per-IP rate limits, and verification-code comparison are safeguards; they are not claimed to prevent all guessing attacks. |
| Shoulder-surfing the QR or code | QR links contain a session secret; code-only pairing requires comparing the numeric verification code. |
| Network eavesdropper | DTLS plus application-layer AES-GCM. |
| Malicious file from the peer | Receiver must accept; no auto-open; filename sanitized; size and type shown before accepting. |
| Peer IP exposure | Documented limitation; no TURN relay is currently configured. |
| Denial of service on signaling | Per-IP rate limits and small session lifetime. |

## 14. Risks and Open Questions

- **Strict college or corporate networks** may block direct WebRTC connections. A TURN relay is not currently configured.
- **iOS Safari limits** on background tabs and large-file downloads may constrain multi-GB transfers on iPhone. Needs early testing.
- **PAKE** has not been implemented; the typed code currently identifies a rendezvous session and users authenticate by comparing the numeric verification code.
- **Resume support** is not implemented; safe resume needs authenticated receiver offset negotiation and nonce continuity.
- **Naming and branding** are undecided.

## 15. Out of Scope for Now (Future Ideas)

- Native Android and desktop clients.
- Persistent trusted devices (pair once, reconnect later).
- Group rooms and one-to-many broadcast.
- Encrypted store-and-forward when the receiver is offline.

## 16. Resume Framing

One-liner: *Built a browser-based peer-to-peer file transfer app using WebRTC, Web Crypto (AES-GCM), QR-link or numeric-code pairing, and chunked file transfer.*
