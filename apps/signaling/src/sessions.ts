import { randomInt } from 'node:crypto';
import type { WebSocket } from 'ws';

export interface ClientConnection {
  ws: WebSocket;
  ip: string;
  role: 'initiator' | 'responder';
  pairingMethod?: 'code' | 'qr';
}

export interface Session {
  id: string;
  code: string;
  initiator: ClientConnection;
  responder?: ClientConnection;
  createdAt: number;
  expiresAt: number;
}

const MIN_SESSION_CODE = 100_000;
const SESSION_CODE_COUNT = 900_000;
const SESSION_CODE_MAX = MIN_SESSION_CODE + SESSION_CODE_COUNT;

/**
 * In-memory session store with automatic TTL expiry (5 minutes).
 * Limits max 2 clients per session and auto-destroys on completion/disconnect.
 */
export class SessionStore {
  private sessionsById = new Map<string, Session>();
  private sessionsByCode = new Map<string, Session>();
  private readonly ttlMs: number;

  constructor(ttlMs = 5 * 60 * 1000) {
    this.ttlMs = ttlMs;

    // Background cleanup of expired sessions every 30 seconds
    setInterval(() => this.cleanupExpired(), 30 * 1000).unref();
  }

  /** Generates a unique six-digit numeric code for the active sessions. */
  public generateCode(): string {
    for (let attempt = 0; attempt < 50; attempt++) {
      const code = String(randomInt(MIN_SESSION_CODE, SESSION_CODE_MAX));
      if (!this.sessionsByCode.has(code)) {
        return code;
      }
    }

    const start = randomInt(MIN_SESSION_CODE, SESSION_CODE_MAX);
    for (let offset = 0; offset < SESSION_CODE_COUNT; offset++) {
      const code = String(MIN_SESSION_CODE + ((start - MIN_SESSION_CODE + offset) % SESSION_CODE_COUNT));
      if (!this.sessionsByCode.has(code)) {
        return code;
      }
    }

    throw new Error('No available session codes');
  }

  public createSession(client: { ws: WebSocket; ip: string }): Session {
    const id = crypto.randomUUID();
    const code = this.generateCode();
    const now = Date.now();

    const session: Session = {
      id,
      code,
      initiator: {
        ws: client.ws,
        ip: client.ip,
        role: 'initiator',
      },
      createdAt: now,
      expiresAt: now + this.ttlMs,
    };

    this.sessionsById.set(id, session);
    this.sessionsByCode.set(code, session);
    return session;
  }

  public getByCode(code: string): Session | undefined {
    const normalized = code.trim().toLowerCase();
    const session = this.sessionsByCode.get(normalized);
    if (!session) return undefined;

    if (Date.now() > session.expiresAt) {
      this.deleteSession(session.id);
      return undefined;
    }
    return session;
  }

  public getById(id: string): Session | undefined {
    const session = this.sessionsById.get(id);
    if (!session) return undefined;

    if (Date.now() > session.expiresAt) {
      this.deleteSession(session.id);
      return undefined;
    }
    return session;
  }

  public joinSession(
    code: string,
    responder: { ws: WebSocket; ip: string; pairingMethod: 'code' | 'qr' },
  ): Session | { error: 'NOT_FOUND' | 'SESSION_FULL' | 'EXPIRED' } {
    const session = this.getByCode(code);
    if (!session) {
      return { error: 'NOT_FOUND' };
    }

    if (session.responder) {
      return { error: 'SESSION_FULL' };
    }

    session.responder = {
      ws: responder.ws,
      ip: responder.ip,
      role: 'responder',
      pairingMethod: responder.pairingMethod,
    };

    return session;
  }

  public findSessionBySocket(ws: WebSocket): { session: Session; role: 'initiator' | 'responder' } | undefined {
    for (const session of this.sessionsById.values()) {
      if (session.initiator.ws === ws) {
        return { session, role: 'initiator' };
      }
      if (session.responder?.ws === ws) {
        return { session, role: 'responder' };
      }
    }
    return undefined;
  }

  public deleteSession(id: string): void {
    const session = this.sessionsById.get(id);
    if (session) {
      this.sessionsById.delete(id);
      this.sessionsByCode.delete(session.code);
    }
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [id, session] of this.sessionsById.entries()) {
      if (now > session.expiresAt) {
        this.deleteSession(id);
      }
    }
  }
}
