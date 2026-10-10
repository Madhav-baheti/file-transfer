import { useEffect, useRef } from 'react';
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
  const signalingRef = useRef<SignalingClient | null>(null);
  const peerRef = useRef<PeerManager | null>(null);

  const cleanupConnections = () => {
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
    actions.reset();
  };

  // ─── 1. Initiator: Create Session Flow ────────────────────────────────────────
  const handleStartCreate = async () => {
    cleanupConnections();
    actions.startCreate();

    const sig = new SignalingClient();
    signalingRef.current = sig;

    try {
      await sig.connect();

      sig.onMessage((msg) => {
        if (msg.type === 'created') {
          actions.created(msg.code);
        } else if (msg.type === 'peer-joined') {
          // Responder has entered the session -> transition to connecting & start offer
          actions.peerFound();

          const peer = new PeerManager({
            signaling: sig,
            isInitiator: true,
            onDataChannelOpen: () => {
              actions.connected();
            },
            onDataChannelClose: () => {
              handleDisconnect();
            },
            onMessage: (data) => {
              // Phase 3: PLAINTEXT text messages only
              actions.addMessage('peer', data);
            },
            onError: (err) => {
              console.error('[WebRTC Initiator Error]', err);
              actions.fail('WebRTC connection failed');
            },
          });

          peerRef.current = peer;
          peer.startOffer().catch((err) => {
            console.error('[WebRTC startOffer Error]', err);
            actions.fail('Failed to create WebRTC offer');
          });
        } else if (msg.type === 'peer-closed') {
          handleDisconnect();
        } else if (msg.type === 'error') {
          actions.fail(msg.reason);
        }
      });

      sig.onDisconnect(() => {
        if (state.status === 'waiting' || state.status === 'connecting') {
          actions.fail('Disconnected from signaling server');
        }
      });

      sig.send({ type: 'create' });
    } catch {
      actions.fail('Could not connect to signaling server. Is it running?');
    }
  };

  // ─── 2. Responder: Join Session Flow ──────────────────────────────────────────
  const handleStartJoin = async (inputCode: string) => {
    cleanupConnections();
    actions.startJoin(inputCode);

    const sig = new SignalingClient();
    signalingRef.current = sig;

    try {
      await sig.connect();

      sig.onMessage((msg) => {
        if (msg.type === 'joined') {
          // Responder successfully joined the session
          const peer = new PeerManager({
            signaling: sig,
            isInitiator: false,
            onDataChannelOpen: () => {
              actions.connected();
            },
            onDataChannelClose: () => {
              handleDisconnect();
            },
            onMessage: (data) => {
              // Phase 3: PLAINTEXT text messages only
              actions.addMessage('peer', data);
            },
            onError: (err) => {
              console.error('[WebRTC Responder Error]', err);
              actions.fail('WebRTC connection failed');
            },
          });

          peerRef.current = peer;
        } else if (msg.type === 'error') {
          actions.fail(msg.reason);
        } else if (msg.type === 'peer-closed') {
          handleDisconnect();
        }
      });

      sig.onDisconnect(() => {
        if (state.status === 'connecting') {
          actions.fail('Disconnected from signaling server');
        }
      });

      sig.send({ type: 'join', code: inputCode });
    } catch {
      actions.fail('Could not connect to signaling server. Is it running?');
    }
  };

  // ─── 3. Send message over RTCDataChannel ──────────────────────────────────────
  const handleSendMessage = (text: string) => {
    if (peerRef.current && state.status === 'connected') {
      peerRef.current.send(text);
      actions.addMessage('self', text);
    }
  };

  // Clean up on component unmount
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

        {state.status === 'connecting' && state.role === 'responder' && (
          <JoinScreen
            onJoin={handleStartJoin}
            onCancel={handleReset}
            error={state.error}
            isConnecting={Boolean(state.code)}
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
          />
        )}

        {(state.status === 'failed' || state.status === 'closed') && (
          <div className={styles.card}>
            <span className={styles.icon}>
              {state.status === 'failed' ? '⚠️' : '🔒'}
            </span>
            <h2>{state.status === 'failed' ? 'Connection Failed' : 'Session Closed'}</h2>
            <p>{state.error || 'The connection was closed.'}</p>
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
