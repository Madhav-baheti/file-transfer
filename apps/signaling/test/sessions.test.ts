import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionStore } from '../src/sessions';
import type { WebSocket } from 'ws';

function createMockSocket(): WebSocket {
  return {
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1, // WebSocket.OPEN
  } as unknown as WebSocket;
}

describe('SessionStore', () => {
  let store: SessionStore;

  beforeEach(() => {
    vi.useFakeTimers();
    // 5-minute TTL per TECH_STACK.md §5
    store = new SessionStore(5 * 60 * 1000);
  });

  it('creates a session with a unique 1-999-word-word code', () => {
    const ws = createMockSocket();
    const session = store.createSession({ ws, ip: '127.0.0.1' });

    expect(session.id).toBeDefined();
    expect(session.code).toMatch(/^[1-9]\d{0,2}-[a-z]+-[a-z]+$/);
    expect(session.initiator.ws).toBe(ws);
    expect(session.responder).toBeUndefined();

    // Verify lookup by code and id
    expect(store.getByCode(session.code)).toBe(session);
    expect(store.getById(session.id)).toBe(session);
  });

  it('allows exactly one responder to join a session', () => {
    const ws1 = createMockSocket();
    const session = store.createSession({ ws: ws1, ip: '10.0.0.1' });

    const ws2 = createMockSocket();
    const joinResult = store.joinSession(session.code, { ws: ws2, ip: '10.0.0.2' });

    expect('error' in joinResult).toBe(false);
    if (!('error' in joinResult)) {
      expect(joinResult.responder).toBeDefined();
      expect(joinResult.responder?.ws).toBe(ws2);
      expect(joinResult.responder?.role).toBe('responder');
    }

    // Attempting to join a third client must be rejected with SESSION_FULL
    const ws3 = createMockSocket();
    const fullResult = store.joinSession(session.code, { ws: ws3, ip: '10.0.0.3' });
    expect(fullResult).toEqual({ error: 'SESSION_FULL' });
  });

  it('expires unpaired sessions after 5 minutes', () => {
    const ws = createMockSocket();
    const session = store.createSession({ ws, ip: '127.0.0.1' });

    expect(store.getByCode(session.code)).toBeDefined();

    // Fast-forward 5 minutes + 1 second
    vi.advanceTimersByTime(5 * 60 * 1000 + 1000);

    expect(store.getByCode(session.code)).toBeUndefined();
    expect(store.getById(session.id)).toBeUndefined();
  });

  it('finds session and role by client socket', () => {
    const ws1 = createMockSocket();
    const ws2 = createMockSocket();
    const session = store.createSession({ ws: ws1, ip: '1.1.1.1' });
    store.joinSession(session.code, { ws: ws2, ip: '2.2.2.2' });

    const foundInitiator = store.findSessionBySocket(ws1);
    expect(foundInitiator?.role).toBe('initiator');
    expect(foundInitiator?.session.id).toBe(session.id);

    const foundResponder = store.findSessionBySocket(ws2);
    expect(foundResponder?.role).toBe('responder');
    expect(foundResponder?.session.id).toBe(session.id);

    const unknownSocket = createMockSocket();
    expect(store.findSessionBySocket(unknownSocket)).toBeUndefined();
  });

  it('deletes session on close', () => {
    const ws = createMockSocket();
    const session = store.createSession({ ws, ip: '127.0.0.1' });

    store.deleteSession(session.id);
    expect(store.getByCode(session.code)).toBeUndefined();
    expect(store.getById(session.id)).toBeUndefined();
  });
});
