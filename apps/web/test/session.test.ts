import { describe, it, expect } from 'vitest';
import {
  sessionReducer,
  initialSessionState,
  type SessionState,
} from '../src/lib/session';

describe('sessionReducer', () => {
  it('starts in initial idle state', () => {
    expect(initialSessionState).toEqual({
      status: 'idle',
      role: null,
      code: null,
      error: null,
      messages: [],
    });
  });

  it('handles START_CREATE by entering waiting state as initiator', () => {
    const next = sessionReducer(initialSessionState, { type: 'START_CREATE' });
    expect(next.status).toBe('waiting');
    expect(next.role).toBe('initiator');
    expect(next.code).toBeNull();
    expect(next.error).toBeNull();
  });

  it('handles CREATED by setting generated code in waiting state', () => {
    const waitingState: SessionState = {
      ...initialSessionState,
      status: 'waiting',
      role: 'initiator',
    };

    const next = sessionReducer(waitingState, { type: 'CREATED', code: '7-kiwi-lamp' });
    expect(next.status).toBe('waiting');
    expect(next.code).toBe('7-kiwi-lamp');
  });

  it('handles PROMPT_JOIN by entering connecting state with empty code as responder', () => {
    const next = sessionReducer(initialSessionState, { type: 'PROMPT_JOIN' });
    expect(next.status).toBe('connecting');
    expect(next.role).toBe('responder');
    expect(next.code).toBeNull();
  });

  it('handles START_JOIN by entering connecting state as responder', () => {
    const next = sessionReducer(initialSessionState, {
      type: 'START_JOIN',
      code: '7-kiwi-lamp',
    });
    expect(next.status).toBe('connecting');
    expect(next.role).toBe('responder');
    expect(next.code).toBe('7-kiwi-lamp');
  });

  it('handles PEER_FOUND and transitions to connecting for initiator', () => {
    const waitingState: SessionState = {
      ...initialSessionState,
      status: 'waiting',
      role: 'initiator',
      code: '7-kiwi-lamp',
    };

    const next = sessionReducer(waitingState, { type: 'PEER_FOUND' });
    expect(next.status).toBe('connecting');
  });

  it('transition guard: CONNECTED only transitions when currently connecting', () => {
    const connectingState: SessionState = {
      ...initialSessionState,
      status: 'connecting',
      role: 'initiator',
      code: '7-kiwi-lamp',
    };

    const next = sessionReducer(connectingState, { type: 'CONNECTED' });
    expect(next.status).toBe('connected');
    expect(next.error).toBeNull();

    // CONNECTED must be ignored if status is idle or waiting
    const fromIdle = sessionReducer(initialSessionState, { type: 'CONNECTED' });
    expect(fromIdle.status).toBe('idle');

    const waitingState: SessionState = { ...initialSessionState, status: 'waiting' };
    const fromWaiting = sessionReducer(waitingState, { type: 'CONNECTED' });
    expect(fromWaiting.status).toBe('waiting');
  });

  it('transition guard: ignore CONNECTED once failed', () => {
    const failedState: SessionState = {
      ...initialSessionState,
      status: 'failed',
      error: 'Network error',
    };

    const next = sessionReducer(failedState, { type: 'CONNECTED' });
    expect(next.status).toBe('failed');
    expect(next.error).toBe('Network error');
  });

  it('transition guard: ignore PEER_FOUND, CONNECTED, and FAIL once closed', () => {
    const closedState: SessionState = {
      ...initialSessionState,
      status: 'closed',
    };

    const afterPeer = sessionReducer(closedState, { type: 'PEER_FOUND' });
    expect(afterPeer.status).toBe('closed');

    const afterConnected = sessionReducer(closedState, { type: 'CONNECTED' });
    expect(afterConnected.status).toBe('closed');

    const afterFail = sessionReducer(closedState, { type: 'FAIL', error: 'Ignored error' });
    expect(afterFail.status).toBe('closed');
    expect(afterFail.error).toBeNull();
  });

  it('handles ADD_MESSAGE with pre-generated id and timestamp (pure reducer)', () => {
    const connectedState: SessionState = {
      ...initialSessionState,
      status: 'connected',
      role: 'initiator',
    };

    const msg = {
      id: 'msg-1',
      sender: 'self' as const,
      text: 'Hello from device A',
      timestamp: '12:00',
    };

    const withMsg = sessionReducer(connectedState, {
      type: 'ADD_MESSAGE',
      message: msg,
    });

    expect(withMsg.messages.length).toBe(1);
    expect(withMsg.messages[0]).toEqual(msg);
  });

  it('handles FAIL and records error message', () => {
    const next = sessionReducer(initialSessionState, {
      type: 'FAIL',
      error: 'Signaling server unreachable',
    });

    expect(next.status).toBe('failed');
    expect(next.error).toBe('Signaling server unreachable');
  });

  it('handles CLOSE and transitions to closed state', () => {
    const connectedState: SessionState = {
      ...initialSessionState,
      status: 'connected',
      role: 'initiator',
    };

    const next = sessionReducer(connectedState, { type: 'CLOSE' });
    expect(next.status).toBe('closed');
  });

  it('handles RESET and returns to initial state', () => {
    const dirtyState: SessionState = {
      status: 'connected',
      role: 'responder',
      code: '7-kiwi-lamp',
      error: 'some error',
      messages: [{ id: '1', sender: 'self', text: 'hi', timestamp: '12:00' }],
    };

    const next = sessionReducer(dirtyState, { type: 'RESET' });
    expect(next).toEqual(initialSessionState);
  });
});
