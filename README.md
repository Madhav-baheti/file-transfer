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

## Security

- **End-to-end encrypted** — ECDH key exchange + AES-256-GCM per chunk
- **Ephemeral keys** — nothing stored in browser storage
- **DTLS binding** — prevents signaling server MITM
- **SAS verification** — visual confirmation that both devices share the same keys
- **No data collection** — no accounts, no cookies, no analytics

---

## License

MIT
