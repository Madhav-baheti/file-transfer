# Security and Threat Model

QuickDrop moves files and text directly between two browsers. This document says exactly what it protects, how, and what it does **not** protect. Nothing here has been independently audited.

## 1. What is protected

- **Content confidentiality and integrity.** File contents, file names and chat messages are encrypted in the sender's browser and decrypted in the receiver's browser. The pairing server, a TURN relay (if one is ever added) and anyone on the network see only encrypted data.
- **No stored copies.** Files never touch a server. Nothing is written to browser storage (no `localStorage`, `sessionStorage` or IndexedDB). Keys exist in memory for one session only.
- **Tamper, replay and reorder detection.** Every message is authenticated. Any altered, replayed, dropped or reordered message ends the session.
- **Forward secrecy per session.** Every session uses fresh ephemeral keys, so recording traffic today does not help an attacker who later compromises a device.

## 2. Roles and trust

| Component | Trusted with | Not trusted with |
|---|---|---|
| Your browser and the other person's browser | Everything | n/a |
| Pairing (signaling) server | Passing connection-setup messages; creating short-lived session codes | File contents, keys, the QR secret |
| Network and Wi-Fi | Nothing | Everything |
| Website host (static files) | Serving the correct JavaScript | See "Web app trust" in section 5 |

The pairing server is treated as **untrusted for confidentiality**. It can see that two devices paired and when, but it cannot read what they send.

## 3. How it works

1. **Pairing.** The creator asks the server for a session. The server returns a short code. The session is single-use, expires after 5 minutes, and requests are rate-limited per client address.
2. **Direct connection.** The browsers exchange connection details through the server and open a WebRTC data channel directly. WebRTC already encrypts that channel with DTLS.
3. **Application-layer key exchange** (on top of DTLS, using the browser's Web Crypto API only, with no custom cryptographic primitives):
   - The initiator sends a **commitment** (hash of its public key and a random nonce). The responder replies with its ephemeral P-256 public key. The initiator then reveals its key and nonce, and the responder checks the commitment.
   - Both sides compute an ECDH shared secret and derive keys with HKDF-SHA-256. The derivation is bound to a transcript that includes both public keys, the nonce and **both sides' DTLS certificate fingerprints** (read from the connection descriptions).
   - Each side proves it derived the same keys by sending an HMAC over the transcript (**key confirmation**).
4. **Message protection.** Every message is encrypted with AES-256-GCM using a separate key per direction. The nonce is built from a fixed per-direction prefix and a strictly increasing counter, so a nonce is never reused. The receiver requires the exact next counter value.
5. **One choke point.** All traffic passes through a single transport layer that accepts only handshake messages before the channel is ready and only encrypted frames afterwards. A plaintext application message is treated as an attack and closes the connection.

## 4. Authentication: how you know who you are talking to

There is no account and no long-term identity, so authentication comes from the pairing method.

| Pairing method | What authenticates the peer | Strength |
|---|---|---|
| **QR code / link** | A random 128-bit secret carried in the URL fragment (`#...`), which browsers never send to any server. The secret is mixed into the key derivation, and it is removed from the address bar after it is read. | Someone who only controls the pairing server or the network cannot complete the handshake. |
| **Typing the short code** | The two users compare an 8-digit **verification code** shown on both screens. Sending and receiving are blocked until the local user confirms. | An attacker must be lucky: because of the commit-then-reveal step they cannot search for keys that produce matching digits, so each attempt succeeds with probability about 1 in 100 million. This only works if both people actually compare the digits. |

Why the digits matter: an attacker who controls the pairing server can run two separate handshakes, one with each person, and relay messages. Key confirmation succeeds on each leg. Only the digit comparison (or the QR secret) exposes this, and the test suite includes this attack.

## 5. What QuickDrop does NOT protect against

- **A compromised website or build.** This is a web app: your browser runs JavaScript downloaded from the host. If the host or the build pipeline were compromised, an attacker could serve malicious code. This is the standing limitation of browser-based end-to-end encryption. No Content-Security-Policy has been configured yet.
- **Metadata.** IP addresses (visible to the other device and to STUN/TURN servers), timing, file sizes and the fact that two devices paired are not hidden.
- **Skipping the digit comparison.** If you confirm the digits without comparing them, a pairing-server attacker can read your transfers.
- **A stolen QR link.** Anyone who gets the link first can join that session. Treat it as a secret. It works once and expires after 5 minutes, but the creator cannot tell a stranger from the intended device in QR mode.
- **A compromised device.** Malware on either device sees everything that device sees.
- **Denial of service.** The free pairing server can be slow, rate-limited or offline. Already-connected sessions do not depend on it.
- **Malicious files.** The receiver must accept each file, names are sanitized, and files are never opened automatically, but QuickDrop does not scan content. Only accept files from people you trust.

## 6. Other safeguards in the code

- **Server hardening.** Exact allowed origins in production (wildcards are rejected at startup), message size limit, per-client rate limiting that takes the client address from the correct position in the proxy chain, keepalive pings, and graceful shutdown. The server never logs codes, addresses or message contents.
- **Receiver limits.** The receiver refuses more data than the offered file size, validates offers, verifies chunk order, total size and a SHA-256 of the whole file, and only reports success after verification. The sender only shows "delivered" after the receiver confirms.
- **Supply chain.** Dependencies are pinned to exact versions. The cryptography uses the browser's built-in Web Crypto implementation.

## 7. Known gaps and future work

- Add a Content-Security-Policy and subresource integrity checks.
- Always show the verification digits, optionally, in QR mode too.
- Consider a password-authenticated key exchange (PAKE) so the short code itself authenticates the peer.
- Add a TURN relay for networks that block direct connections (relayed traffic would still be encrypted).
- Independent review of the handshake and message framing.

## 8. Reporting a vulnerability

Please use GitHub's private vulnerability reporting on this repository (Security tab). Do not post exploit details in a public issue.
