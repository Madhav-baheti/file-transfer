# TECH_STACK.md: Encrypted P2P File & Text Transfer

> **For the coding agent:** Read `PRD.md` first, then this file. This file is the source of truth for *how* to build. Where the two disagree, this file wins, and any deviation is listed in Section 12. Do not add dependencies, services, or features that are not listed here without asking.

## Status (as built)

- QR-link pairing and six-digit numeric rendezvous codes are implemented.
- Code-only pairing requires comparing an eight-digit numeric verification code; it is not word-based.
- The handshake uses commit-then-reveal ephemeral ECDH bound to DTLS fingerprints; PAKE is not implemented.
- `SecureTransport` is the application-message boundary to and from the raw WebRTC data channel.
- File transfer uses chunks, receiver acknowledgements, backpressure, and a 16 MiB sender in-flight window.
- The receiver checks chunk order, byte totals, and SHA-256; its in-memory fallback is capped at 2 GiB.
- Multi-file queue, PWA/share-target, and dark-theme code exists; real-device behavior is not claimed verified.
- The signaling server and static site are deployed on Render's free plan using `render.yaml`.
- TURN credential code exists, but no TURN relay is configured; interrupted-transfer resume is not implemented.
- CSP is not configured; the Render Blueprint sets `Referrer-Policy`, `X-Content-Type-Options`, and `X-Frame-Options`.

## 1. Decisions at a Glance

| Concern | Decision |
|---|---|
| Language | TypeScript everywhere (strict mode) |
| Repo layout | pnpm workspaces monorepo |
| Frontend | React + Vite, plain CSS modules (no UI framework in v1) |
| Signaling server | Node.js (current LTS) + `ws` WebSocket library, in-memory sessions |
| Shared code | `packages/protocol`: message types and validation (zod) |
| Transport | WebRTC `RTCDataChannel` (ordered, reliable) |
| NAT traversal | Public STUN; TURN credential generation exists, but no TURN relay is configured |
| Key exchange | Ephemeral ECDH P-256 via Web Crypto, keys bound to DTLS fingerprints |
| Payload encryption | AES-256-GCM via Web Crypto, per-chunk nonce |
| Pairing | QR (high-entropy secret in URL fragment) + 6-digit numeric rendezvous code + 8-digit numeric SAS |
| QR generate / scan | `qrcode` renders QR images; opening the link joins. No in-app camera scanner is present. |
| Large file saving | File System Access API where supported; in-memory Blob fallback capped at 2 GiB |
| PWA | `vite-plugin-pwa` manifest/service worker and Web Share Target handling are present in source |
| Tests | Vitest; no Playwright end-to-end suite is configured |
| Lint / format | ESLint + Prettier |
| Hosting | Render static site and Node signaling service on the free plan (`render.yaml`) |

**Why TypeScript everywhere:** WebRTC and Web Crypto only exist in the browser, so the client must be JS/TS. Using the same language for the signaling server lets both sides share one protocol package, which removes a whole class of mismatch bugs. A Java backend would add a second language for no benefit here.

**Why no UI framework or state library:** the app has about three screens. Plain React state plus CSS modules keeps the dependency list short and the code easy to read for a portfolio.

## 2. Development Environment (Windows 11)

- Install Node.js 22, then `corepack enable` and use **pnpm**.
- Use PowerShell or Git Bash; every command in this repo must work in PowerShell.
- Test on real devices: run the web app with Vite and open it from a phone on the same Wi-Fi. Web Crypto requires a **secure context**, so use `localhost` on the same machine or an HTTPS tunnel for phone testing.
- Git from the first commit, with small commits per feature, because this repo is also a GitHub portfolio piece.

## 3. Repository Structure

```
p2p-transfer/
├─ PRD.md
├─ TECH_STACK.md
├─ README.md
├─ package.json                # workspace root scripts
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ .eslintrc.cjs / eslint.config.js
├─ .prettierrc
├─ apps/
│  ├─ web/                     # React + Vite client; PWA implementation in source
│  │  ├─ src/
│  │  │  ├─ App.tsx
│  │  │  ├─ components/        # App UI, pairing, queue, and transfer components
│  │  │  ├─ lib/               # WebRTC, SecureTransport, transfer logic
│  │  │  └─ styles/
│  │  └─ test/                 # Vitest client tests
│  └─ signaling/               # Node.js signaling server
│     ├─ src/                  # HTTP, WebSocket, sessions, config
│     └─ test/                 # Vitest server tests
├─ packages/
│  └─ protocol/                # shared message types + zod schemas
│     └─ src/index.ts
```

## 4. Frontend (`apps/web`)

- **React 18+ with Vite and TypeScript (strict).** Function components and hooks only.
- **State:** `useReducer` for the pairing and transfer state machines. No Redux, Zustand, or similar in v1.
- **Routing:** none needed; a single-page flow driven by session state (`home → create|join → connected`).
- **QR:** `qrcode` renders a QR link to a canvas. Joining from QR opens the link; no in-app camera scanner is present.
- **PWA:** `vite-plugin-pwa` configures a manifest and service worker; Web Share Target handling is present in source. Installed-device behavior still requires testing.
- **File saving:**
  - Chromium: `showSaveFilePicker()` and write chunks to a `FileSystemWritableFileStream` as they arrive, so memory stays constant.
  - When the File System Access API is unavailable, collect chunks into a `Blob` and trigger a download; this fallback holds file contents in memory and has a 2 GiB limit in code.
- **File reading:** `File.stream()` or `Blob.slice()` to read in 16 KB chunks; never `readAsArrayBuffer` on a whole file.
- **Styling:** CSS modules, mobile first (design at 360 px width), system color preference, and a session-only theme control.

## 5. Signaling Server (`apps/signaling`)

- **Node.js + `ws`**, one process, no database. Signaling sessions live in a `Map` and are deleted on expiry, completion, or disconnect.
- **Responsibilities:** create a session, let exactly one second client join, relay signaling messages, issue short-lived TURN credentials when configured, and expire in-memory session entries.
- **It must never** see file bytes, filenames, or encryption keys, and must never log message payloads.
- **Limits:**
  - Session entry expires after `SESSION_TTL_MS` (5 minutes by default), measured from creation.
  - Maximum 2 clients per session; a session is single-use.
  - Per-IP token bucket on create and join attempts (for example 10 per minute).
  - Maximum WebSocket message size of 64 KB.
  - Validate `Origin` against an allow-list from environment config.
- **Config via environment variables:** `PORT`, `ALLOWED_ORIGINS`, `SESSION_TTL_MS`, `TRUST_PROXY_HOPS`; optional server-only `TURN_URLS` and `TURN_SHARED_SECRET`.
- **Health endpoint:** `GET /health` returns 200.

### Signaling protocol (defined in `packages/protocol`, validated with zod on both ends)

| Message | Direction | Purpose |
|---|---|---|
| `create` | client → server | Ask for a new session |
| `created { sessionId, code }` | server → client | Session ready; `code` is the short code |
| `join { code }` | client → server | Second device joins by code |
| `joined` / `peer-joined` | server → clients | Both sides are present; start WebRTC |
| `signal { kind: "offer" \| "answer" \| "ice", data }` | client ↔ server ↔ client | Relayed verbatim; server does not interpret `data` |
| `error { reason }` | server → client | Expired, full, rate limited, invalid |
| `close` | either | End the session |

## 6. WebRTC and Transfer Protocol

- **Peer connection:** one `RTCPeerConnection`, one ordered reliable `RTCDataChannel` for control and data (a second channel for bulk data can come later if needed).
- **ICE servers:** public STUN is used. The signaling service can issue short-lived TURN credentials if relay settings and a shared secret are configured; no relay is currently configured.
- **Chunking:** 16 KiB messages. Sender backpressure uses a 1 MiB low threshold and a 2 MiB channel high-water mark, with a 16 MiB acknowledgement window. The receiver acknowledges written bytes.
- **Application message types through `SecureTransport`** (encrypted after key exchange):
  - `file-offer { id, name, size, mime }` → receiver shows Accept / Decline
  - `file-accept { id }` / `file-decline { id }`
  - encrypted binary chunk frames with file ID, chunk index, and payload
  - `file-ack { id, bytes }` → receiver acknowledges written bytes
  - `file-end { id, sha256, chunkCount, totalBytes }` → receiver verifies hash, count, and size
  - `file-result { id, ok, error? }` → receiver reports verification outcome
  - `file-cancel { id }`
  - `text { body }`
- **Filename safety:** strip path separators and control characters, cap length, never auto-open files.

## 7. Cryptography

Use only the browser's **Web Crypto API** (`crypto.subtle`) plus the platform CSPRNG (`crypto.getRandomValues`). **Do not write any custom cryptographic primitive and do not add a general crypto library in v1.**

1. **Pairing secret.** The QR encodes a URL carrying a random secret in its fragment. The fragment is not sent to the server.
2. **Key exchange.** The commit-then-reveal handshake exchanges ephemeral ECDH P-256 public keys through `SecureTransport`.
3. **Binding.** Derive session keys with HKDF-SHA-256 from the ECDH shared secret, optional QR pairing secret, transcript, and both DTLS certificate fingerprints taken from the SDP. PAKE is not used for code-only pairing.
4. **Payload encryption.** AES-256-GCM per chunk. Nonce = 96 bits built from a random per-direction prefix plus a counter, never reused with the same key. Include the file id and chunk index as additional authenticated data.
5. **SAS verification.** Derive and display an eight-digit numeric value from the transcript. Code-only pairing requires local confirmation after the users compare digits; QR pairing does not require this confirmation.
6. **Ephemeral only.** Cryptographic keys exist in memory for the session and are not persisted in browser storage.
7. **Short code format:** a six-digit number from 100000 to 999999. It is a rendezvous identifier, not a PAKE credential. Session entries expire after the configured TTL (five minutes by default); create/join requests are rate-limited.

## 8. Testing and Quality

- **Automated tests:** Vitest tests are present for web and signaling. The protocol package's test script reports no tests; no Playwright end-to-end suite or CI workflow is configured.
- **Manual device testing:** phone/laptop, mobile-data, and restrictive-network behavior require real-device testing and are not claimed verified.
- **TypeScript:** `strict: true`, no `any` without a comment explaining why.

## 9. Deployment

| Piece | Recommendation | Notes |
|---|---|---|
| `apps/web` | Render static site defined in `render.yaml` | Deployed on the free plan; HTTPS URL is configured in the Blueprint. |
| `apps/signaling` | Render Node web service defined in `render.yaml` | Deployed on the free plan and supports WebSockets. |
| TURN | Optional coturn relay with short-lived credentials | Credential code exists, but no TURN relay is currently configured. |

The Render Blueprint sets `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, and `X-Frame-Options: DENY`. It does not currently set a Content-Security-Policy.

## 10. Build Order for the Agent

Complete each phase and show it working before starting the next. Commit after each phase.

1. **Scaffold:** pnpm workspace, TypeScript configs, ESLint, Prettier, empty `web`, `signaling`, and `protocol` packages that build.
2. **Signaling server:** create/join/relay with expiry and rate limiting, plus unit tests.
3. **Connect two tabs:** pairing by code, WebRTC connected, exchange a text message in plaintext (proof of concept).
4. **File transfer:** chunking, backpressure, accept/decline, progress, cancel, hash verification. Test with a 1 GB file for constant memory use.
5. **Crypto layer:** ECDH + HKDF + AES-GCM, DTLS fingerprint binding, SAS screen. All data now encrypted; tests for tampering.
6. **QR pairing:** QR-link generation and fragment-carried secret implemented.
7. **PWA and polish:** manifest, service worker, share-target handling, theme control, and UI polish implemented in source; device validation remains.
8. **P1 items:** multi-file queue implemented; TURN relay not configured; interrupted-transfer resume not implemented.
9. **Docs:** README with architecture diagram, threat model, setup steps, and demo GIF.

## 11. Rules for the Agent

- Never log message payloads, filenames, codes, or keys on the server.
- Never send the URL fragment or any secret to a server.
- Never reuse an AES-GCM nonce with the same key.
- Do not store anything in browser storage.
- Prefer the platform APIs (Web Crypto, Streams, File System Access) over third-party packages.
- Every new dependency needs a one-line justification in the pull request or commit message.
- Keep functions small and typed; add a short comment explaining *why* for anything security-related.
- When something in this file is ambiguous or seems wrong, stop and ask instead of guessing.

## 12. Deviations from the PRD

- **PAKE is not implemented.** The typed code is a rendezvous identifier; code-only pairing authenticates through user comparison and confirmation of the numeric SAS.
- **Dark mode** is implemented in the polish phase rather than remaining only a P2 proposal.

## 13. First Prompt to Paste into Antigravity

```
Read PRD.md and TECH_STACK.md in this workspace fully before doing anything.
Then execute Phase 1 (Scaffold) from Section 10 of TECH_STACK.md only.
Show me the folder structure and the commands to run it on Windows 11 PowerShell,
and stop for my review before starting Phase 2.
```
