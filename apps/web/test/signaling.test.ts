import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SignalingClient } from '../src/lib/signaling';

// ─── Mock Browser WebSocket ───────────────────────────────────────────────────

class MockWebSocket {
  public static OPEN = 1;
  public static CLOSED = 3;

  public readyState = MockWebSocket.OPEN;
  public onopen: (() => void) | null = null;
  public onclose: (() => void) | null = null;
  public onerror: ((err: unknown) => void) | null = null;
  public onmessage: ((e: { data: string }) => void) | null = null;

  public send = vi.fn();
  public close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
    // Trigger onclose asynchronously
    queueMicrotask(() => {
      this.onclose?.();
    });
  });

  constructor(_url: string) {
    queueMicrotask(() => {
      this.onopen?.();
    });
  }
}

// @ts-expect-error Mock browser WebSocket
globalThis.WebSocket = MockWebSocket;

describe('SignalingClient Disconnect Suppression', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('suppresses onDisconnect and onError callbacks when closed intentionally by close()', async () => {
    const client = new SignalingClient('ws://localhost:3001');
    const onDisconnect = vi.fn();
    const onError = vi.fn();

    client.onDisconnect(onDisconnect);
    client.onError(onError);

    await client.connect();

    // Call close() intentionally
    client.close();

    // Fast-forward any timers or microtasks
    await vi.runAllTimersAsync();

    // Listeners must NOT be invoked when closed intentionally
    expect(onDisconnect).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('triggers onDisconnect callback when closed unexpectedly by remote server', async () => {
    const client = new SignalingClient('ws://localhost:3001');
    const onDisconnect = vi.fn();

    client.onDisconnect(onDisconnect);
    await client.connect();

    const socketInstance = (client as unknown as { ws: MockWebSocket }).ws;
    // Simulate remote server abrupt socket closure
    socketInstance.onclose?.();

    expect(onDisconnect).toHaveBeenCalled();
  });
});
