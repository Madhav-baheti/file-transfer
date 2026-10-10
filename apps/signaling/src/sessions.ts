import { WORD_LIST } from '@quickdrop/protocol';
import type { WebSocket } from 'ws';

export interface ClientConnection {
  ws: WebSocket;
  ip: string;
  role: 'initiator' | 'responder';
}

export interface Session {
  id: string;
  code: string;
  initiator: ClientConnection;
  responder?: ClientConnection;
  createdAt: number;
  expiresAt: number;
}

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

  /**
   * Generates a collision-resistant human-readable code:
   * e.g., "42-kiwi-lamp"
   */
  public generateCode(): string {
    const maxAttempts = 50;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const num = Math.floor(Math.random() * 999) + 1;
      const w1 = WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)];
      const w2 = WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)];
      const code = `${num}-${w1}-${w2}`.toLowerCase();

      if (!this.sessionsByCode.has(code)) {
        return code;
      }
    }
    // Fallback with timestamp suffix if collisions occur
    return `${Math.floor(Math.random() * 999) + 1}-drop-${Date.now().toString(36)}`;
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

  public joinSession(code: string, responder: { ws: WebSocket; ip: string }): Session | { error: 'NOT_FOUND' | 'SESSION_FULL' | 'EXPIRED' } {
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
