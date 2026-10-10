import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import {
  PROTOCOL_VERSION,
  ClientMessageSchema,
  type ServerMessage,
} from '@quickdrop/protocol';
import { SessionStore } from './sessions';
import { TokenBucketRateLimiter } from './rateLimit';
import { loadConfig } from './config';

const config = loadConfig();
const sessionStore = new SessionStore(config.sessionTtlMs);
const rateLimiter = new TokenBucketRateLimiter(config.rateLimitCapacity, config.rateLimitRefillRate);

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

/**
 * Creates HTTP & WebSocket servers for signaling.
 * Enforces origins, message limits, rate limiting, and opaque signal relays.
 */
const server = createServer((req, res) => {
  // CORS check for HTTP
  const origin = req.headers.origin;
  if (origin && config.allowedOrigins[0] !== '*' && !config.allowedOrigins.includes(origin)) {
    res.writeHead(403);
    res.end('Origin not allowed');
    return;
  }

  // Health endpoint per TECH_STACK.md §5
  if (req.url === '/health') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({ status: 'ok', protocol: PROTOCOL_VERSION }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

const wss = new WebSocketServer({
  server,
  maxPayload: config.maxMessageSize,
  verifyClient: (info, callback) => {
    const origin = info.origin;
    if (config.allowedOrigins[0] !== '*' && origin && !config.allowedOrigins.includes(origin)) {
      callback(false, 403, 'Forbidden origin');
      return;
    }
    callback(true);
  },
});

wss.on('connection', (ws, req) => {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';

  ws.on('message', (rawData) => {
    let payload: unknown;
    try {
      payload = JSON.parse(rawData.toString());
    } catch {
      send(ws, { type: 'error', reason: 'Invalid JSON payload', code: 'INVALID_MESSAGE' });
      return;
    }

    const parseResult = ClientMessageSchema.safeParse(payload);
    if (!parseResult.success) {
      send(ws, {
        type: 'error',
        reason: 'Malformed message format: ' + parseResult.error.message,
        code: 'INVALID_MESSAGE',
      });
      return;
    }

    const msg = parseResult.data;

    switch (msg.type) {
      case 'create': {
        if (!rateLimiter.consume(ip)) {
          send(ws, { type: 'error', reason: 'Rate limit exceeded, please wait', code: 'RATE_LIMITED' });
          return;
        }

        const session = sessionStore.createSession({ ws, ip });
        send(ws, {
          type: 'created',
          sessionId: session.id,
          code: session.code,
        });
        break;
      }

      case 'join': {
        if (!rateLimiter.consume(ip)) {
          send(ws, { type: 'error', reason: 'Rate limit exceeded, please wait', code: 'RATE_LIMITED' });
          return;
        }

        const result = sessionStore.joinSession(msg.code, { ws, ip });
        if ('error' in result) {
          send(ws, { type: 'error', reason: `Join error: ${result.error}`, code: result.error });
          return;
        }

        // Notify responder that they've joined
        send(ws, { type: 'joined', role: 'responder' });

        // Notify initiator that peer has joined
        send(result.initiator.ws, { type: 'peer-joined' });
        break;
      }

      case 'signal': {
        // Relayed verbatim; server does NOT inspect data payloads or encryption keys
        const userSession = sessionStore.findSessionBySocket(ws);
        if (!userSession) {
          send(ws, { type: 'error', reason: 'No active session found', code: 'NOT_FOUND' });
          return;
        }

        const target = userSession.role === 'initiator'
          ? userSession.session.responder?.ws
          : userSession.session.initiator.ws;

        if (target && target.readyState === WebSocket.OPEN) {
          send(target, {
            type: 'signal',
            kind: msg.kind,
            data: msg.data,
          });
        }
        break;
      }

      case 'close': {
        const userSession = sessionStore.findSessionBySocket(ws);
        if (userSession) {
          const peer = userSession.role === 'initiator'
            ? userSession.session.responder?.ws
            : userSession.session.initiator.ws;

          if (peer && peer.readyState === WebSocket.OPEN) {
            send(peer, { type: 'peer-closed', reason: msg.reason });
          }

          sessionStore.deleteSession(userSession.session.id);
        }
        ws.close();
        break;
      }
    }
  });

  ws.on('close', () => {
    const userSession = sessionStore.findSessionBySocket(ws);
    if (userSession) {
      const peer = userSession.role === 'initiator'
        ? userSession.session.responder?.ws
        : userSession.session.initiator.ws;

      if (peer && peer.readyState === WebSocket.OPEN) {
        send(peer, { type: 'peer-closed', reason: 'Peer disconnected abruptly' });
      }

      sessionStore.deleteSession(userSession.session.id);
    }
  });
});

server.listen(config.port, () => {
  console.log(`[signaling] QuickDrop signaling server online on http://localhost:${config.port}`);
  console.log(`[signaling] Protocol v${PROTOCOL_VERSION}`);
  console.log(`[signaling] Health check: http://localhost:${config.port}/health`);
});
