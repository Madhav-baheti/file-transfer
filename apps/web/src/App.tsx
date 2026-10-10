import { useEffect, useRef, useState } from 'react';
import { PROTOCOL_VERSION } from '@quickdrop/protocol';
import { useSessionStateMachine } from './lib/session';
import { SignalingClient } from './lib/signaling';
import { PeerManager } from './lib/peer';
import { CreateScreen } from './screens/CreateScreen';
import { JoinScreen } from './screens/JoinScreen';
import { ConnectedScreen } from './screens/ConnectedScreen';
import styles from './App.module.css';

export function App() {
  const { state, actions } = useSessionStateMachine();
  const [sendError, setSendError] = useState<string | null>(null);

  const signalingRef = useRef<SignalingClient | null>(null);
  const peerRef = useRef<PeerManager | null>(null);

  // Keep latest status in a ref to avoid stale closures in callbacks (Item 2)
  const statusRef = useRef(state.status);
  statusRef.current = state.status;

  // Timers: 20s connection timeout and 5s disconnect grace timer
  const connectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disconnectGraceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearConnectionTimeout = () => {
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
  };

  const clearDisconnectGraceTimeout = () => {
    if (disconnectGraceTimeoutRef.current) {
      clearTimeout(disconnectGraceTimeoutRef.current);
      disconnectGraceTimeoutRef.current = null;
    }
  };

  const startConnectionTimeout = () => {
    clearConnectionTimeout();
    connectionTimeoutRef.current = setTimeout(() => {
      if (statusRef.current === 'connecting' || statusRef.current === 'waiting') {
        cleanupConnections();
        actions.fail('Connection timed out');
      }
    }, 20000); // 20 second connection timeout per Item 4
  };

  const cleanupConnections = () => {
    clearConnectionTimeout();
    clearDisconnectGraceTimeout();

    peerRef.current?.close();
    peerRef.current = null;

    signalingRef.current?.close();
    signalingRef.current = null;
  };

  const handleDisconnect = () => {
    cleanupConnections();
    actions.close();
  };

  const handleReset = () => {
    cleanupConnections();
    setSendError(null);
    actions.reset();
  };

  const setupPeerConnectionEvents = () => {
    return {
      onDataChannelOpen: () => {
        clearConnectionTimeout();
        clearDisconnectGraceTimeout();
        actions.connected();
      },
      onDataChannelClose: () => {
        handleDisconnect();
      },
      onMessage: (data: string) => {
        // Phase 3: PLAINTEXT text messages capped at 4000 characters
        actions.addMessage('peer', data);
      },
      onConnectionStateChange: (pcState: RTCPeerConnectionState) => {
        // Item 3: wire onConnectionStateChange for both peers
        if (pcState === 'connected') {
          clearDisconnectGraceTimeout();
        } else if (pcState === 'failed') {
          cleanupConnections();
          actions.fail(
            'Could not establish a direct connection (the network may be blocking peer-to-peer)',
          );
        } else if (pcState === 'disconnected') {
          clearDisconnectGraceTimeout();
          disconnectGraceTimeoutRef.current = setTimeout(() => {
            if (statusRef.current === 'connected') {
              handleDisconnect();
            }
          }, 5000); // wait 5 seconds; if still not connected, close
        } else if (pcState === 'closed') {
          handleDisconnect();
        }
      },
      onError: (err: unknown) => {
        console.error('[WebRTC Error]', err);
        cleanupConnections();
        actions.fail('WebRTC connection failed');
      },
    };
  };

  // ─── 1. Initiator: Create Session Flow ────────────────────────────────────────
  const handleStartCreate = async () => {
    cleanupConnections();
    setSendError(null);
    actions.startCreate();

    const sig = new SignalingClient();
    signalingRef.current = sig;

    try {
      await sig.connect();

      sig.onMessage((msg) => {
        if (msg.type === 'created') {
          actions.created(msg.code);
        } else if (msg.type === 'peer-joined') {
          // Peer found -> start 20s connection timeout and initiate WebRTC offer
          actions.peerFound();
          startConnectionTimeout();

          const callbacks = setupPeerConnectionEvents();

          const peer = new PeerManager({
            signaling: sig,
            isInitiator: true,
            ...callbacks,
          });

          peerRef.current = peer;
          peer.startOffer().catch((err) => {
            console.error('[WebRTC startOffer Error]', err);
            cleanupConnections();
            actions.fail('Failed to create WebRTC offer');
          });
        } else if (msg.type === 'peer-closed') {
          handleDisconnect();
        } else if (msg.type === 'error') {
          cleanupConnections();
          actions.fail(msg.reason);
        }
      });

      sig.onDisconnect(() => {
        // Use statusRef to prevent stale closures
        if (statusRef.current === 'waiting' || statusRef.current === 'connecting') {
          cleanupConnections();
          actions.fail('Disconnected from signaling server');
        }
      });

      sig.send({ type: 'create' });
    } catch {
      cleanupConnections();
      actions.fail('Could not connect to signaling server. Is it running?');
    }
  };

  // ─── 2. Responder: Join Session Flow ──────────────────────────────────────────
  const handleStartJoin = async (inputCode: string) => {
    cleanupConnections();
    setSendError(null);
    actions.startJoin(inputCode);

    const sig = new SignalingClient();
    signalingRef.current = sig;

    try {
      await sig.connect();

      sig.onMessage((msg) => {
        if (msg.type === 'joined') {
          // Responder successfully joined the session -> start 20s connection timeout
          startConnectionTimeout();

          const callbacks = setupPeerConnectionEvents();

          const peer = new PeerManager({
            signaling: sig,
            isInitiator: false,
            ...callbacks,
          });

          peerRef.current = peer;
        } else if (msg.type === 'error') {
          // Item 8: Wrong code allows retrying on the Join screen without returning home
          clearConnectionTimeout();
          peerRef.current?.close();
          peerRef.current = null;
          signalingRef.current?.close();
          signalingRef.current = null;
          actions.fail(msg.reason);
        } else if (msg.type === 'peer-closed') {
          handleDisconnect();
        }
      });

      sig.onDisconnect(() => {
        // Use statusRef to prevent stale closures
        if (statusRef.current === 'connecting') {
          cleanupConnections();
          actions.fail('Disconnected from signaling server');
        }
      });

      sig.send({ type: 'join', code: inputCode });
    } catch {
      cleanupConnections();
      actions.fail('Could not connect to signaling server. Is it running?');
    }
  };

  // ─── 3. Send message over RTCDataChannel ──────────────────────────────────────
  const handleSendMessage = (text: string) => {
    setSendError(null);
    const trimmed = text.trim();
    if (!trimmed) return;

    if (!peerRef.current || statusRef.current !== 'connected') {
      setSendError('Cannot send: data channel is not connected');
      return;
    }

    try {
      peerRef.current.send(trimmed);
      actions.addMessage('self', trimmed);
    } catch (err) {
      console.error('[Send Message Error]', err);
      setSendError('Failed to send message: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  // Clean up on component unmount (Item 4)
  useEffect(() => {
    return () => {
      cleanupConnections();
    };
  }, []);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>QuickDrop</h1>
        <p className={styles.subtitle}>
          Transfer files and text directly. No sign-up. No cloud. Just a code.
        </p>
      </header>

      <main className={styles.cards}>
        {state.status === 'idle' && (
          <>
            <div className={styles.card}>
              <span className={styles.icon}>📤</span>
              <h2>Create Session</h2>
              <p>Create a session and get a code for the other device</p>
              <button
                className={styles.primaryButton}
                onClick={handleStartCreate}
                type="button"
              >
                Create
              </button>
            </div>
            <div className={styles.card}>
              <span className={styles.icon}>📥</span>
              <h2>Join Session</h2>
              <p>Enter an existing session code to connect</p>
              <button
                className={styles.secondaryButton}
                onClick={() => actions.promptJoin()}
                type="button"
              >
                Join
              </button>
            </div>
          </>
        )}

        {state.status === 'waiting' && (
          <CreateScreen code={state.code} onCancel={handleReset} />
        )}

        {/* Item 8: If responder failed (e.g. wrong code), stay on JoinScreen so user can retry */}
        {((state.status === 'connecting' && state.role === 'responder') ||
          (state.status === 'failed' && state.role === 'responder')) && (
          <JoinScreen
            onJoin={handleStartJoin}
            onCancel={handleReset}
            error={state.error}
            isConnecting={state.status === 'connecting' && Boolean(state.code)}
          />
        )}

        {state.status === 'connecting' && state.role === 'initiator' && (
          <div className={styles.card}>
            <span className={styles.icon}>⚡</span>
            <h2>Connecting...</h2>
            <p>Peer joined. Establishing direct WebRTC connection...</p>
            <button className={styles.secondaryButton} onClick={handleReset} type="button">
              Cancel
            </button>
          </div>
        )}

        {state.status === 'connected' && (
          <ConnectedScreen
            role={state.role}
            messages={state.messages}
            onSendMessage={handleSendMessage}
            onDisconnect={handleDisconnect}
            sendError={sendError}
          />
        )}

        {/* Failed or Closed for initiator or unhandled states */}
        {((state.status === 'failed' && state.role !== 'responder') ||
          state.status === 'closed') && (
          <div className={styles.card}>
            <span className={styles.icon}>
              {state.status === 'failed' ? '⚠️' : '🔒'}
            </span>
            <h2>{state.status === 'failed' ? 'Connection Failed' : 'Session Closed'}</h2>
            <p>{state.error || 'The session was closed.'}</p>
            <button className={styles.primaryButton} onClick={handleReset} type="button">
              Return Home
            </button>
          </div>
        )}
      </main>

      {state.status === 'idle' && (
        <section className={styles.steps}>
          <div className={styles.step}>
            <span className={styles.stepNumber}>1</span>
            <span>Create Session</span>
          </div>
          <span className={styles.stepArrow}>→</span>
          <div className={styles.step}>
            <span className={styles.stepNumber}>2</span>
            <span>Share Code</span>
          </div>
          <span className={styles.stepArrow}>→</span>
          <div className={styles.step}>
            <span className={styles.stepNumber}>3</span>
            <span>Connect & Chat</span>
          </div>
        </section>
      )}

      <footer className={styles.footer}>
        <span>⚡ Direct WebRTC DataChannel</span>
        <span>🚫 Zero server storage</span>
        <span>📄 Phase 3: Plaintext POC</span>
      </footer>

      <p className={styles.version}>Protocol v{PROTOCOL_VERSION}</p>
    </div>
  );
}
