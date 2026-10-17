import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import {
  PROTOCOL_VERSION,
  ClientMessageSchema,
  type ServerMessage,
} from '@quickdrop/protocol';
import { SessionStore } from './sessions.js';
import { TokenBucketRateLimiter } from './rateLimit.js';
import { loadConfig } from './config.js';
import { getClientIp } from './clientIp.js';
import { createTurnCredentials } from './turnCredentials.js';

const config = loadConfig();
const sessionStore = new SessionStore(config.sessionTtlMs);
const rateLimiter = new TokenBucketRateLimiter(config.rateLimitCapacity, config.rateLimitRefillRate);
const aliveClients = new WeakMap<WebSocket, boolean>();
let shuttingDown = false;

function log(event: string): void {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    service: 'signaling',
    event,
  }));
}

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
  if (
    origin &&
    !config.allowedOrigins.includes('*') &&
    !config.allowedOrigins.includes(origin)
  ) {
    res.writeHead(403);
    res.end('Origin not allowed');
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    log('health_check');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (origin) headers['Access-Control-Allow-Origin'] = origin;
    res.writeHead(200, {
      ...headers,
    });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'GET' && req.url?.split('?')[0] === '/turn-credentials') {
    const isAllowedOrigin =
      origin !== undefined &&
      (config.allowedOrigins.includes('*') || config.allowedOrigins.includes(origin));
    const clientIp = getClientIp(
      req.headers['x-forwarded-for'],
      req.socket.remoteAddress,
      config.trustProxyHops,
    );
    if (!isAllowedOrigin || !rateLimiter.consume(clientIp)) {
      res.writeHead(403, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify({ error: 'TURN credentials are unavailable' }));
      return;
    }

    if (config.turnUrls.length === 0 || !config.turnSharedSecret) {
      res.writeHead(503, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify({ error: 'TURN relay is not configured' }));
      return;
    }

    const credentials = createTurnCredentials(config.turnUrls, config.turnSharedSecret);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': origin,
      Vary: 'Origin',
    });
    res.end(JSON.stringify(credentials));
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
    if (
      !config.allowedOrigins.includes('*') &&
      (!origin || !config.allowedOrigins.includes(origin))
    ) {
      callback(false, 403, 'Forbidden origin');
      return;
    }
    callback(true);
  },
});

wss.on('connection', (ws, req) => {
  const ip = getClientIp(
    req.headers['x-forwarded-for'],
    req.socket.remoteAddress,
    config.trustProxyHops,
  );
  aliveClients.set(ws, true);
  log('websocket_client_connected');
  ws.on('pong', () => {
    aliveClients.set(ws, true);
  });

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
          log('rate_limit_rejected operation=create');
          send(ws, { type: 'error', reason: 'Rate limit exceeded, please wait', code: 'RATE_LIMITED' });
          return;
        }

        const session = sessionStore.createSession({ ws, ip });
        log('session_created');
        send(ws, {
          type: 'created',
          sessionId: session.id,
          code: session.code,
        });
        break;
      }

      case 'join': {
        if (!rateLimiter.consume(ip)) {
          log('rate_limit_rejected operation=join');
          send(ws, { type: 'error', reason: 'Rate limit exceeded, please wait', code: 'RATE_LIMITED' });
          return;
        }

        const result = sessionStore.joinSession(msg.code, {
          ws,
          ip,
          pairingMethod: msg.pairingMethod,
        });
        if ('error' in result) {
          log(`session_join_rejected reason=${result.error}`);
          send(ws, { type: 'error', reason: `Join error: ${result.error}`, code: result.error });
          return;
        }

        log('session_peer_joined');
        // Notify responder that they've joined
        send(ws, { type: 'joined', role: 'responder' });

        // Notify initiator that peer has joined
        send(result.initiator.ws, {
          type: 'peer-joined',
          pairingMethod: result.responder?.pairingMethod ?? 'code',
        });
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
          log('session_closed');
        }
        ws.close();
        break;
      }
    }
  });

  ws.on('close', () => {
    log('websocket_client_disconnected');
    const userSession = sessionStore.findSessionBySocket(ws);
    if (userSession) {
      const peer = userSession.role === 'initiator'
        ? userSession.session.responder?.ws
        : userSession.session.initiator.ws;

      if (peer && peer.readyState === WebSocket.OPEN) {
        send(peer, { type: 'peer-closed', reason: 'Peer disconnected abruptly' });
      }

      sessionStore.deleteSession(userSession.session.id);
      log('session_closed');
    }
  });
});

const keepAliveInterval = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    if (aliveClients.get(ws) === false) {
      ws.terminate();
      continue;
    }
    aliveClients.set(ws, false);
    ws.ping((error?: Error) => {
      if (error) ws.terminate();
    });
  }
}, 25_000);
keepAliveInterval.unref();

function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log('shutdown signal received; closing server');
  clearInterval(keepAliveInterval);

  const forceExitTimer = setTimeout(() => {
    for (const ws of wss.clients) ws.terminate();
    server.closeAllConnections();
    process.exit(0);
  }, 5000);

  server.close(() => {
    clearTimeout(forceExitTimer);
    process.exit(0);
  });

  for (const ws of wss.clients) {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close(1001, 'Server shutting down');
    }
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(config.port, '0.0.0.0', () => {
  log(`QuickDrop signaling server online on port ${config.port}`);
  log(`Protocol v${PROTOCOL_VERSION}`);
  log('Health check available at /health');
});
