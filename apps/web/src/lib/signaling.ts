import {
  type ClientMessage,
  type ServerMessage,
  ServerMessageSchema,
} from '@quickdrop/protocol';

export type SignalingEventHandler = (msg: ServerMessage) => void;

/**
 * WebSocket client for the QuickDrop signaling server.
 * Uses Zod schemas from @quickdrop/protocol to validate incoming server messages.
 */
export class SignalingClient {
  private ws: WebSocket | null = null;
  private url: string;
  private messageListeners = new Set<SignalingEventHandler>();
  private disconnectListeners = new Set<() => void>();
  private errorListeners = new Set<(err: Event) => void>();

  constructor(url?: string) {
    this.url = url || import.meta.env.VITE_SIGNALING_URL || 'ws://localhost:3001';
  }

  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          resolve();
        };

        this.ws.onerror = (err) => {
          for (const listener of this.errorListeners) {
            listener(err);
          }
          reject(err);
        };

        this.ws.onclose = () => {
          for (const listener of this.disconnectListeners) {
            listener();
          }
        };

        this.ws.onmessage = (event) => {
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
        reject(err);
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
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.send({ type: 'close' });
      }
      this.ws.close();
      this.ws = null;
    }
  }
}
