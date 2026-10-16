import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveSignalingUrl, SignalingClient } from '../src/lib/signaling';

// ─── Mock Browser WebSocket ───────────────────────────────────────────────────

class MockWebSocket {
  public static OPEN = 1;
  public static CONNECTING = 0;
  public static CLOSED = 3;
  public static autoOpen = true;
  public static instances: MockWebSocket[] = [];

  public readyState = MockWebSocket.CONNECTING;
  public onopen: (() => void) | null = null;
  public onclose: (() => void) | null = null;
  public onerror: ((err: unknown) => void) | null = null;
  public onmessage: ((e: { data: string }) => void) | null = null;
  public readonly url: string;

  public send = vi.fn();
  public close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
    queueMicrotask(() => {
      this.onclose?.();
    });
  });

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    if (MockWebSocket.autoOpen) {
      queueMicrotask(() => this.open());
    }
  }

  public open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }
}

// @ts-expect-error Mock browser WebSocket
globalThis.WebSocket = MockWebSocket;

describe('SignalingClient Disconnect Suppression', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.autoOpen = true;
    MockWebSocket.instances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('enforces production and local-development URL rules', () => {
    expect(() => resolveSignalingUrl(undefined, true, 'example.com')).toThrow(
      /VITE_SIGNALING_URL must be set/,
    );
    expect(() => resolveSignalingUrl('ws://signal.example', true, 'example.com')).toThrow(
      /must start with wss:\/\//,
    );
    expect(resolveSignalingUrl('wss://signal.example', true, 'example.com')).toBe(
      'wss://signal.example',
    );
    expect(resolveSignalingUrl('ws://localhost:3001', false, 'localhost')).toBe(
      'ws://localhost:3001',
    );
    expect(resolveSignalingUrl('ws://127.0.0.1:3001', false, '127.0.0.1')).toBe(
      'ws://127.0.0.1:3001',
    );
    expect(() => resolveSignalingUrl('ws://signal.example', false, 'example.com')).toThrow(
      /only when the page is served from localhost/,
    );
  });

  it('marks the connection pending after three seconds and clears the state on open', async () => {
    MockWebSocket.autoOpen = false;
    const client = new SignalingClient('ws://localhost:3001');
    const onPending = vi.fn();
    client.onPending(onPending);
    const connected = client.connect();
    const connectionAssertion = expect(connected).resolves.toBeUndefined();

    await vi.advanceTimersByTimeAsync(2999);
    expect(client.isPending).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(client.isPending).toBe(true);
    expect(onPending).toHaveBeenCalledOnce();

    MockWebSocket.instances[0].open();
    await connectionAssertion;
    expect(client.isPending).toBe(false);
    client.close();
  });

  it('rejects a connection attempt after 75 seconds', async () => {
    MockWebSocket.autoOpen = false;
    const client = new SignalingClient('ws://localhost:3001');
    const connected = client.connect();
    const rejection = expect(connected).rejects.toThrow(
      'Signaling connection timed out after 75 seconds.',
    );

    await vi.advanceTimersByTimeAsync(75000);
    await rejection;
    expect(MockWebSocket.instances[0].close).toHaveBeenCalledOnce();
    expect(client.isPending).toBe(false);
  });

  it('rejects a pending connection when close() is called and clears pending state', async () => {
    MockWebSocket.autoOpen = false;
    const client = new SignalingClient('ws://localhost:3001');
    const connected = client.connect();
    const rejection = expect(connected).rejects.toThrow(
      'Signaling connection closed before opening.',
    );

    await vi.advanceTimersByTimeAsync(3000);
    expect(client.isPending).toBe(true);

    client.close();
    await rejection;

    expect(client.isPending).toBe(false);
    expect(MockWebSocket.instances[0].close).toHaveBeenCalledOnce();
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
