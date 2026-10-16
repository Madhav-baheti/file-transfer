# QuickDrop

QuickDrop is a browser-based, peer-to-peer file and text transfer app. Two devices
pair with a QR link or a short code, then exchange messages and files over a WebRTC
data channel. It has no account system or cloud file storage.

## Features

- Create a session and share its QR link or six-digit code; join by scanning the link
  with a device camera or entering the code.
- Send text and queue multiple files in selection order. Each file waits for the
  receiver to accept or decline before its contents are sent.
- View per-file transfer state and progress, and cancel queued or active files.
- Verify received file integrity with SHA-256; filenames are sanitized and files are
  not opened automatically.
- Use short-lived TURN credentials from the signaling service when an operator has
  configured a coturn relay. STUN/direct connectivity remains available without TURN.
- Install as a PWA where supported. The PWA has a system-preference dark theme and a
  session-only theme toggle. Supported installed browsers can share files into an
  in-memory queue; the user must still connect and explicitly send.
- Resume interrupted transfers: **not implemented**. A new transfer in a new session
  is required after the secure channel closes.

Implementation notes: code-only pairing does not use PAKE; it requires users to
compare and confirm the displayed verification digits. QR pairing uses a random
secret in the URL fragment. On browsers without the File System Access API, received
files are assembled in memory and the receiver rejects transfers above 2 GiB. The
project has not verified multi-gigabyte behavior, all supported browsers, or reliable
cross-network connectivity on real devices.

## Architecture

```text
 Browser A                         Signaling server                         Browser B
    |                                      |                                    |
    |---- create / join (six-digit code) ->|<---- join (code) ------------------|
    |<--- SDP offer/answer and ICE relay ->|<---> SDP offer/answer and ICE ---->|
    |                                      |                                    |
    |---- ICE connectivity checks via STUN servers ----------------------------|
    |                 (optional TURN relay if a direct route cannot be used)   |
    |                                                                           |
    |<====== WebRTC data channel: DTLS + application-encrypted messages ======>|
    |             text, file offers, chunks, acknowledgements                   |
    |                                                                           |
    +---- file contents travel between the browsers over this data channel -----+

 Signaling relays connection-setup messages; it is not the file-data path.
 If TURN is used, it relays encrypted WebRTC packets, not application plaintext.
```

The signaling service creates a one-to-one in-memory rendezvous entry and relays
WebRTC setup messages (SDP and ICE candidates). The browsers attempt a direct data
channel connection using ICE and STUN; if configured and selected, TURN relays the
WebRTC packets. The data channel uses WebRTC DTLS and QuickDrop's application-level
encryption.

## Security and privacy

### What the implementation does

- Each connection uses ephemeral P-256 ECDH key pairs. The key derivation uses
  HKDF-SHA-256 and binds in the exchanged DTLS certificate fingerprints.
- Data-channel messages are encrypted with AES-256-GCM. Nonces use a per-direction
  prefix and counter; authenticated data binds file/chunk identity. The receiver
  checks file chunk order and the final SHA-256 digest.
- QR pairing adds a random 128-bit secret carried in the URL fragment. The fragment
  is not part of the HTTP request to the signaling server and is removed from the
  address bar after automatic joining. Anyone who obtains an unexpired QR link can
  attempt to join its session; share it only with the intended device.
- With code-only pairing, the six-digit code identifies the rendezvous session; it
  is not a PAKE password. Users must compare and confirm the displayed verification
  digits on both devices before sending. Do not skip that comparison.
- Pairing entries and codes are kept in signaling-server memory, are single-use, and
  are removed after `SESSION_TTL_MS` (five minutes by default) or on session
  disconnect. The configured TTL is measured from session creation, including for a
  paired entry; expiry removes signaling state but does not itself guarantee that an
  already-established WebRTC data channel is closed.
- Pairing secrets, session keys, and shared files are not persisted by the app in
  localStorage, IndexedDB, or cookies. The PWA service worker precaches app-shell
  assets, not transfer data or signaling responses. Shared files are held in memory
  until they can be placed into the ordinary send queue.
- Signaling logs do not include client IPs, codes, SDP, filenames, or message
  payloads. Rate limiting still uses client IPs in memory.

### What this does not protect against

Encryption does not protect a compromised device, browser, or delivered web app, or
prevent the receiving peer from retaining or redistributing a file. The signaling
service sees session codes, connection-setup metadata, request origins, and client
network addresses. Peers and STUN/TURN infrastructure may learn network addresses;
the TURN operator can observe packet timing and volume even though TURN carries
encrypted WebRTC traffic. File size and timing can also be inferred from traffic.

Code-only pairing has no PAKE and its authentication depends on a correct SAS
comparison; the short code alone is not proof of peer identity. The implementation
has not undergone an independent cryptographic audit. Denial of service and network
metadata privacy are not solved. Do not treat QuickDrop as a substitute for a
security review or a threat-model-specific secure file-sharing service.

## Windows 11 setup

Prerequisites:

- Windows 11 and Git.
- Node.js 20 or newer (current LTS recommended).
- Corepack and pnpm 9 or newer.

In PowerShell, from the repository root:

```powershell
corepack enable
pnpm install
pnpm dev
```

The web app is served at `http://localhost:5173`; the local signaling server listens
at `ws://localhost:3001`. The development signaling server defaults to allowing all
origins. To test, open the app in two browser tabs or devices, create a session in
one, and join from the other.

The web app requires a secure browser context for Web Crypto and browser APIs. On the
same computer, `localhost` is suitable. A phone accessing a PC by LAN IP does not
usually get the browser's localhost secure-context exception; use an HTTPS tunnel
for device testing and configure the web app's signaling URL and server origin
allow-list to match the tunnel addresses.

To use a custom local web configuration, copy the example and edit it:

```powershell
Copy-Item apps/web/.env.example apps/web/.env.local
```

For a local server, `VITE_SIGNALING_URL=ws://localhost:3001` is the default. Do not
put TURN credentials or other secrets in a `VITE_*` variable: Vite exposes those
values to the built client.

## Development commands

Run commands from the repository root:

| Command              | Purpose                                                                          |
| -------------------- | -------------------------------------------------------------------------------- |
| `pnpm dev`           | Run workspace development commands in parallel (protocol watch, web, signaling). |
| `pnpm dev:web`       | Run only the Vite web app.                                                       |
| `pnpm dev:signaling` | Run only the signaling server with `tsx watch`.                                  |
| `pnpm build`         | Build the protocol package, then the apps.                                       |
| `pnpm typecheck`     | Type-check workspace packages.                                                   |
| `pnpm lint`          | Run ESLint.                                                                      |
| `pnpm test`          | Run the workspace Vitest scripts.                                                |
| `pnpm format:check`  | Check formatting with Prettier.                                                  |

There is no configured Playwright end-to-end test suite in the repository. The web
and signaling packages have Vitest tests; the protocol package's test script reports
that it has no tests yet.

## Configuration

### Web app

| Variable             | Purpose and behavior                                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_SIGNALING_URL` | Signaling WebSocket URL. Defaults to `ws://localhost:3001` in development; production requires a `wss://` URL.                                              |
| `VITE_ICE_SERVERS`   | Optional comma-separated STUN URLs. Invalid or non-STUN values fall back to the built-in public STUN servers. TURN credentials must not be configured here. |

The examples are in [apps/web/.env.example](./apps/web/.env.example).

### Signaling service

| Variable                 |                                        Default | Purpose                                                                                                                                                                                                                  |
| ------------------------ | ---------------------------------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PORT`                   |                                         `3001` | HTTP/WebSocket listening port. The service binds to `0.0.0.0`; Render supplies this value.                                                                                                                               |
| `ALLOWED_ORIGINS`        | `*` outside production; required in production | Comma-separated exact web origins, including scheme and port when applicable. Wildcards and an empty value are rejected in production.                                                                                   |
| `SESSION_TTL_MS`         |                                       `300000` | Lifetime of an in-memory signaling rendezvous entry from creation, in milliseconds.                                                                                                                                      |
| `TRUST_PROXY_HOPS`       |                                            `0` | Trusted proxy count used for rate-limit IP selection. For a positive value, the service counts from the right of `X-Forwarded-For`; otherwise it uses the socket address. Set this only to match the actual proxy chain. |
| `RATE_LIMIT_CAPACITY`    |                                           `15` | Token-bucket burst capacity for create/join and TURN-credential requests.                                                                                                                                                |
| `RATE_LIMIT_REFILL_RATE` |                                          `0.5` | Tokens replenished per second.                                                                                                                                                                                           |
| `TURN_URLS`              |                                          unset | Optional comma-separated `turn:`/`turns:` relay URLs.                                                                                                                                                                    |
| `TURN_SHARED_SECRET`     |                                          unset | Coturn REST shared secret; at least 32 characters. Used only by signaling to generate credentials. Configure with `TURN_URLS`.                                                                                           |

The server example is [apps/signaling/.env.example](./apps/signaling/.env.example).
TURN variables are optional: if TURN is unavailable or misconfigured, the web client
continues with STUN/direct connection attempts. TURN credentials expire after ten
minutes and are returned without caching.

## Deployment

The repository includes a Render Blueprint in [render.yaml](./render.yaml). It
defines a free Node web service for signaling and a static web app:

1. Create or update a Render Blueprint from this repository and review the services
   and environment values before applying it.
2. The signaling build installs the locked workspace dependencies, builds
   `@quickdrop/protocol` and `@quickdrop/signaling`, and starts
   `node apps/signaling/dist/index.js`. Its health check is `GET /health`.
3. The static build installs dependencies, builds the protocol and web app, and
   publishes `apps/web/dist`. It rewrites app paths to `index.html` and configures
   `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, and
   `X-Frame-Options: DENY`.
4. Confirm that `VITE_SIGNALING_URL` is the signaling service's `wss://` address and
   that `ALLOWED_ORIGINS` contains the static site's exact HTTPS origin. The
   Blueprint currently contains example project hostnames; update these values if
   Render assigns different service URLs. The static app's `VITE_SIGNALING_URL` is
   a build-time setting.
5. For TURN, deploy and secure a coturn service separately. Configure REST shared
   secret authentication (`use-auth-secret` and `static-auth-secret`), set
   `TURN_URLS` and `TURN_SHARED_SECRET` as private signaling-service variables, and
   allow the required listener and relay ports through the firewall. Do not expose
   the shared secret in the Blueprint, web environment, or source code.

Render's free signaling service may cold-start, so initial connection can take
longer. `ALLOWED_ORIGINS` must be an exact comma-separated allow-list in production.
The currently configured Blueprint does not set a Content-Security-Policy header.

## Troubleshooting

| Symptom                                                      | Checks                                                                                                                                                                                                           |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm` is not recognized                                     | Run `corepack enable`, reopen PowerShell, and check `node --version` and `pnpm --version`.                                                                                                                       |
| Workspace/package build cannot resolve `@quickdrop/protocol` | Run `pnpm install`, then `pnpm build` from the repository root so the shared protocol package is built first.                                                                                                    |
| Browser reports Web Crypto or secure-context errors          | Use `localhost` on the same machine or an HTTPS deployment/tunnel. A plain HTTP LAN address is generally not a secure context.                                                                                   |
| Pairing service does not connect locally                     | Confirm `pnpm dev` is running and the web app points to `ws://localhost:3001`. Check port conflicts and browser developer-console errors.                                                                        |
| Production join fails immediately                            | Check that the signaling service is healthy at `/health`, `VITE_SIGNALING_URL` uses `wss://`, and `ALLOWED_ORIGINS` exactly matches the web origin.                                                              |
| Session code is rejected or already in use                   | Create a fresh session and join before its five-minute signaling-entry TTL. Only one peer can join each session.                                                                                                 |
| Code-only verification does not match                        | Do not confirm or send files. Disconnect and create a new session; check both devices are joining the same code and compare the displayed digits.                                                                |
| Connection stalls or fails on a restrictive network          | ICE/STUN may not find a usable route. Configure valid short-lived TURN credentials and coturn firewall/relay ports; TURN availability does not guarantee every network will connect.                             |
| File offer is declined or transfer stops                     | The receiver must accept each file. Check that both browsers remain open, the channel stays connected, and the receiver has a supported save path and enough memory/disk. There is no resume after interruption. |
| Receive-to-memory transfer exceeds its limit                 | Use a browser with File System Access API support where available, or transfer a smaller file. The in-memory receive fallback rejects files above 2 GiB.                                                         |
| Shared files do not appear in the installed app              | Share Target requires an installed PWA and browser support. Open the app normally and use its multi-file picker/drop area if the share destination is unavailable.                                               |
| App update is waiting                                        | The app exposes a user-controlled refresh; wait until the active session ends before applying it.                                                                                                                |

## Launch checklist

### Implemented and covered by repository checks

- [x] QR and code pairing flows, encrypted WebRTC data channel, code-pair SAS confirmation.
- [x] Ordered multi-file queue with per-file accept/decline, progress, cancellation, and SHA-256 integrity checking.
- [x] Optional signaling-issued TURN credentials with STUN fallback.
- [x] PWA manifest, app-shell service worker, dark theme control, and configured Web Share Target handoff.
- [x] Unit tests, typecheck, lint, and production builds are available as workspace commands.

These checkmarks describe code and automated checks, not real-world deployment or
device verification.

### Still requires launch validation

- [ ] Deploy the Render Blueprint; confirm actual service URLs, `GET /health`,
      WebSocket connectivity, allowed origins, and static response headers.
- [ ] Test pairing and transfers between real devices and different networks,
      including a restrictive network with the chosen TURN provider.
- [ ] Verify PWA installation and file sharing on each target browser/OS; this has
      not been tested on real devices.
- [ ] Measure representative transfer sizes, memory use, save behavior, and
      background/foreground behavior on supported devices.
- [ ] Review the threat model and cryptographic implementation independently before
      relying on it for sensitive data.
- [ ] Decide whether to add a real demo capture. No suitable demo GIF currently
      exists in the repository, so none is included here.

## License

MIT
