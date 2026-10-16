# QuickDrop

**Encrypted peer-to-peer file & text transfer via unique session codes.**

No sign-up. No cloud storage. No file size worries. Just a code.

---

## How It Works

1. **Create** — One device creates a session and gets a short code + QR
2. **Connect** — The other device enters the code or scans the QR
3. **Transfer** — Files and text flow directly between browsers, end-to-end encrypted

> Files never touch a server. The signaling server only helps the two browsers find each other, then gets out of the way.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite + TypeScript |
| Signaling | Node.js + WebSocket (`ws`) |
| Transport | WebRTC `RTCDataChannel` (peer-to-peer) |
| Encryption | ECDH P-256 + AES-256-GCM (Web Crypto API) |
| Shared types | `packages/protocol` with `zod` validation |
| Monorepo | pnpm workspaces |

---

## Project Structure

```
quickdrop/
├─ apps/
│  ├─ web/                  # React client (PWA)
│  └─ signaling/            # WebSocket signaling server
├─ packages/
│  └─ protocol/             # Shared message types + zod schemas
├─ tests/
│  └─ e2e/                  # Playwright end-to-end tests
├─ PRD.md                   # Product requirements
└─ TECH_STACK.md            # Technical specification
```

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v20+ (LTS)
- [pnpm](https://pnpm.io/) v9+

```powershell
# Enable pnpm via corepack
corepack enable

# Install dependencies
pnpm install

# Start everything (web + signaling server)
pnpm dev
```

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all packages in parallel |
| `pnpm dev:web` | Start only the web client |
| `pnpm dev:signaling` | Start only the signaling server |
| `pnpm build` | Build all packages |
| `pnpm lint` | Run ESLint |
| `pnpm format` | Format with Prettier |
| `pnpm typecheck` | Type-check all packages |

---

## Install the PWA and share files

Deploy the web app over HTTPS, open it in a supported browser, then use the browser's
**Install app** / **Add to Home Screen** action. Once installed, QuickDrop appears as
a share destination on browsers that implement the Web Share Target API. Select files
from the system share sheet; they are held in page/service-worker memory only and are
placed in the normal send queue after you create or join a session. Each queued file
still requires the peer to accept its offer before any file bytes are sent.

Web Share Target support depends on the browser and installed-PWA implementation. If
QuickDrop is not listed, open the app and choose files from its multi-file picker or
drop them onto the send area.

## TURN relay deployment (optional)

STUN/direct WebRTC remains the default. To enable fallback, configure a coturn server
with REST-style shared-secret authentication (`use-auth-secret` and
`static-auth-secret` in coturn). Allow the TURN listener and relay UDP port range
through the server firewall. For restrictive networks, configure TURN/TLS on a
reachable TCP port as well.

Set these variables **only on the signaling server**:

| Variable | Value |
|---|---|
| `TURN_URLS` | Comma-separated relay URLs, for example `turn:turn.example:3478?transport=udp,turns:turn.example:5349?transport=tcp` |
| `TURN_SHARED_SECRET` | The same high-entropy secret configured as coturn's `static-auth-secret`; use at least 32 characters |

The signaling service exposes `GET /turn-credentials` only to allowed web origins.
It generates coturn-compatible HMAC credentials that expire after 10 minutes and
returns them with `Cache-Control: no-store`. The web client fetches them at pairing
time. Missing or malformed TURN configuration leaves the public STUN/direct attempt
available. Never set TURN usernames or passwords in `VITE_*` variables or frontend
source. When deploying on Render, set `TURN_URLS` and `TURN_SHARED_SECRET` as private
environment variables on the signaling service and add the web origin to
`ALLOWED_ORIGINS`.

## Transfer queue and resume

Files are sent in selection/drop order, one at a time. Each offer waits for the
receiver's explicit acceptance; failures, declines, and cancellations are tracked per
file. Interrupted transfers cannot currently be resumed: a channel interruption
closes the live in-memory file sender/receiver state, and the existing handshake has
no channel re-establishment or authenticated resume-offset negotiation. QuickDrop
does not persist file data, keys, or session secrets, and deliberately does not retry
chunks with existing AES-GCM keys because that could reuse nonces.

---

## Security

- **End-to-end encrypted** — ECDH key exchange + AES-256-GCM per chunk
- **Ephemeral keys** — nothing stored in browser storage
- **DTLS binding** — prevents signaling server MITM
- **SAS verification** — visual confirmation that both devices share the same keys
- **No data collection** — no accounts, no cookies, no analytics

---

## License

MIT
