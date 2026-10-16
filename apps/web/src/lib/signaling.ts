import {
  type ClientMessage,
  type ServerMessage,
  ServerMessageSchema,
} from '@quickdrop/protocol';

export type SignalingEventHandler = (msg: ServerMessage) => void;

const CONNECTION_TIMEOUT_MS = 75_000;

export function resolveSignalingUrl(
  configuredUrl: string | undefined,
  isProduction: boolean,
  pageHostname: string,
): string {
  const url = configuredUrl?.trim() || (isProduction ? '' : 'ws://localhost:3001');
  if (!url) {
    throw new Error('VITE_SIGNALING_URL must be set to a wss:// URL in production.');
  }
  if (isProduction && !url.startsWith('wss://')) {
    throw new Error('VITE_SIGNALING_URL must start with wss:// in production.');
  }
  if (url.startsWith('ws://') && pageHostname !== 'localhost' && pageHostname !== '127.0.0.1') {
    throw new Error('ws:// signaling URLs are allowed only when the page is served from localhost or 127.0.0.1.');
  }
  if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
    throw new Error('VITE_SIGNALING_URL must start with ws:// or wss://.');
  }
  return url;
}

/**
 * WebSocket client for the QuickDrop signaling server.
 * Uses Zod schemas from @quickdrop/protocol to validate incoming server messages.
 */
export class SignalingClient {
  private ws: WebSocket | null = null;
  private configuredUrl: string | undefined;
  private messageListeners = new Set<SignalingEventHandler>();
  private disconnectListeners = new Set<() => void>();
  private errorListeners = new Set<(err: Event) => void>();
  private pendingListeners = new Set<() => void>();
  private closedByUs = false;
  private pending = false;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private connectionTimer: ReturnType<typeof setTimeout> | null = null;
  private rejectPendingConnection: ((reason: Error) => void) | null = null;

  constructor(url?: string) {
    this.configuredUrl = url ?? import.meta.env.VITE_SIGNALING_URL;
  }

  public get isPending(): boolean {
    return this.pending;
  }

  public onPending(handler: () => void): () => void {
    this.pendingListeners.add(handler);
    if (this.pending) handler();
    return () => this.pendingListeners.delete(handler);
  }

  public connect(): Promise<void> {
    this.closedByUs = false;
    return new Promise((resolve, reject) => {
      const hostname = typeof window === 'undefined' ? 'localhost' : window.location.hostname;
      let url: string;
      try {
        url = resolveSignalingUrl(this.configuredUrl, import.meta.env.PROD, hostname);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      let settled = false;
      let opened = false;
      const clearConnectionTimers = () => {
        if (this.pendingTimer) clearTimeout(this.pendingTimer);
        if (this.connectionTimer) clearTimeout(this.connectionTimer);
        this.pendingTimer = null;
        this.connectionTimer = null;
        this.pending = false;
      };
      const settleFailure = (error: Error) => {
        if (settled) return;
        settled = true;
        clearConnectionTimers();
        this.rejectPendingConnection = null;
        this.closedByUs = true;
        this.ws?.close();
        reject(error);
      };

      this.rejectPendingConnection = settleFailure;
      try {
        this.ws = new WebSocket(url);

        this.pendingTimer = setTimeout(() => {
          if (settled) return;
          this.pending = true;
          for (const listener of this.pendingListeners) listener();
        }, 3000);

        this.connectionTimer = setTimeout(() => {
          settleFailure(new Error('Signaling connection timed out after 75 seconds.'));
        }, CONNECTION_TIMEOUT_MS);

        this.ws.onopen = () => {
          if (settled) return;
          opened = true;
          settled = true;
          clearConnectionTimers();
          this.rejectPendingConnection = null;
          resolve();
        };

        this.ws.onerror = (err) => {
          if (!this.closedByUs) {
            for (const listener of this.errorListeners) {
              listener(err);
            }
          }
          settleFailure(new Error('Could not connect to the signaling service.'));
        };

        this.ws.onclose = () => {
          if (!opened) {
            settleFailure(new Error('Signaling connection closed before opening.'));
          }
          if (!this.closedByUs) {
            for (const listener of this.disconnectListeners) {
              listener();
            }
          }
        };

        this.ws.onmessage = (event) => {
          if (this.closedByUs) return;
          try {
            const raw = JSON.parse(event.data);
            const parsed = ServerMessageSchema.safeParse(raw);
            if (parsed.success) {
              for (const listener of this.messageListeners) {
                listener(parsed.data);
              }
            } else {
              console.warn('[signaling] Unrecognized server message schema:', parsed.error);
            }
          } catch (e) {
            console.error('[signaling] Failed to parse message JSON:', e);
          }
        };
      } catch (err) {
        settleFailure(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  public send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      console.warn('[signaling] Cannot send: WebSocket is not open');
    }
  }

  public onMessage(handler: SignalingEventHandler): () => void {
    this.messageListeners.add(handler);
    return () => this.messageListeners.delete(handler);
  }

  public onDisconnect(handler: () => void): () => void {
    this.disconnectListeners.add(handler);
    return () => this.disconnectListeners.delete(handler);
  }

  public onError(handler: (err: Event) => void): () => void {
    this.errorListeners.add(handler);
    return () => this.errorListeners.delete(handler);
  }

  public close(): void {
    this.closedByUs = true;
    this.pending = false;
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    if (this.connectionTimer) clearTimeout(this.connectionTimer);
    this.pendingTimer = null;
    this.connectionTimer = null;
    const ws = this.ws;
    if (ws?.readyState === WebSocket.OPEN) {
      this.send({ type: 'close' });
    }
    this.ws = null;
    this.rejectPendingConnection?.(new Error('Signaling connection closed before opening.'));
    this.rejectPendingConnection = null;
    ws?.close();
  }
}
