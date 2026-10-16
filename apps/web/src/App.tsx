import { useEffect, useRef, useState } from 'react';
import { useSessionStateMachine } from './lib/session';
import { SignalingClient } from './lib/signaling';
import { PeerManager } from './lib/peer';
import { generatePairingSecret, SecureChannelError } from './lib/secureChannel';
import {
  buildPairingUrl,
  parsePairingFragment,
  scrubPairingFragment,
} from './lib/pairingLink';
import { createConnectionTimer, type ConnectionTimer } from './lib/connectionTimer';
import { useTransferStateMachine } from './lib/transferState';
import { FileSender, FileReceiver, sanitizeFilename } from './lib/transfer';
import {
  PlaintextTransportCodec,
  ControlMessageSchema,
  type ControlMessage,
} from './lib/protocol';
import { CreateScreen } from './screens/CreateScreen';
import { JoinScreen } from './screens/JoinScreen';
import { ConnectedScreen } from './screens/ConnectedScreen';
import { NavBar } from './components/NavBar';
import { DecorativeTiles } from './components/DecorativeTiles';
import { PairingCards } from './components/PairingCards';
import { LightSections } from './components/LightSections';
import styles from './App.module.css';

const SIGNALING_UNREACHABLE_MESSAGE =
  'The pairing service is not reachable. Check your internet connection and try again.';
const VERIFICATION_FAILED_MESSAGE =
  'Verification failed. The digits did not match, so the connection may not be secure. Nothing was sent.';
const PAIRING_MODE_MISMATCH_MESSAGE =
  'The two devices could not agree on a secure key. If one device used the QR link and the other typed the code, start again: create the session in code-only mode, or join with the QR link. If that was not the case, someone may be interfering with the connection.';

interface VerificationState {
  sas: string;
  required: boolean;
  confirmed: boolean;
}

const INITIAL_VERIFICATION_STATE: VerificationState = {
  sas: '',
  required: false,
  confirmed: false,
};

export function App() {
  const { state, actions } = useSessionStateMachine();
  const {
    state: transferState,
    actions: transferActions,
  } = useTransferStateMachine();

  const [sendError, setSendError] = useState<string | null>(null);
  const [initialPairing] = useState(() => parsePairingFragment(window.location.hash));
  const [signalingPending, setSignalingPending] = useState(false);
  const [themeOverride, setThemeOverride] = useState<boolean | null>(null);
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  const [needRefresh, setNeedRefresh] = useState(false);
  const [updateError, setUpdateError] = useState(false);
  const [verification, setVerification] = useState<VerificationState>(
    INITIAL_VERIFICATION_STATE,
  );
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  const signalingRef = useRef<SignalingClient | null>(null);
  const peerRef = useRef<PeerManager | null>(null);
  const pairingSecretRef = useRef<Uint8Array | null>(null);
  const connectionAttemptRef = useRef(0);

  // Active sender and receiver instances
  const senderRef = useRef<FileSender | null>(null);
  const receiverRef = useRef<FileReceiver | null>(null);

  // Keep latest statuses in refs to avoid stale closures in callbacks
  const statusRef = useRef(state.status);
  statusRef.current = state.status;

  const transferStatusRef = useRef(transferState.status);
  transferStatusRef.current = transferState.status;

  const transferOfferRef = useRef(transferState.offer);
  transferOfferRef.current = transferState.offer;

  const verificationRef = useRef(verification);
  verificationRef.current = verification;

  const isDark = themeOverride ?? systemPrefersDark;
  const isSessionActive =
    state.status === 'waiting' ||
    state.status === 'connecting' ||
    state.status === 'connected' ||
    transferState.status === 'offered' ||
    transferState.status === 'transferring' ||
    transferState.status === 'verifying' ||
    transferState.status === 'awaiting_confirmation';

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const updateSystemTheme = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches);
    mediaQuery.addEventListener('change', updateSystemTheme);
    return () => mediaQuery.removeEventListener('change', updateSystemTheme);
  }, []);

  useEffect(() => {
    if (themeOverride === null) {
      document.documentElement.removeAttribute('data-theme');
      return;
    }
    document.documentElement.dataset.theme = themeOverride ? 'dark' : 'light';
  }, [themeOverride]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        registrationRef.current = registration;
        setUpdateError(false);

        const updateReady = () => {
          if (!isSessionActive && !registration.installing) {
            setNeedRefresh(true);
          }
        };

        registration.addEventListener('updatefound', () => {
          const installingWorker = registration.installing;
          if (!installingWorker) return;
          installingWorker.addEventListener('statechange', () => {
            if (installingWorker.state === 'installed') {
              updateReady();
            }
          });
        });

        if (registration.waiting) {
          setNeedRefresh(true);
        }
      })
      .catch(() => setUpdateError(true));
  }, [isSessionActive]);

  // Timers created via createConnectionTimer
  const connectionTimerRef = useRef<ConnectionTimer | null>(null);
  const disconnectGraceTimerRef = useRef<ConnectionTimer | null>(null);
  const transferConfirmationTimerRef = useRef<ConnectionTimer | null>(null);

  const cleanupConnections = () => {
    connectionAttemptRef.current += 1;
    connectionTimerRef.current?.clear();
    disconnectGraceTimerRef.current?.clear();
    transferConfirmationTimerRef.current?.clear();

    senderRef.current?.cancel('Connection closed');
    senderRef.current = null;

    receiverRef.current?.cancel('Connection closed');
    receiverRef.current = null;

    transferActions.resetTransfer();
    verificationRef.current = INITIAL_VERIFICATION_STATE;
    setVerification(INITIAL_VERIFICATION_STATE);
    pairingSecretRef.current = null;
    setSignalingPending(false);

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

  const handleToggleTheme = () => {
    setThemeOverride(!isDark);
  };

  const handleApplyUpdate = async () => {
    if (!registrationRef.current) return;
    try {
      await registrationRef.current.update();
      if (registrationRef.current.waiting) {
        registrationRef.current.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
      window.location.reload();
    } catch {
      setUpdateError(true);
    }
  };

  const handleSecureReady = (info: { sas: string; requiresSasConfirmation: boolean }) => {
    if (
      statusRef.current === 'idle' ||
      statusRef.current === 'closed' ||
      statusRef.current === 'failed'
    ) {
      return;
    }

    const nextVerification: VerificationState = {
      sas: info.sas,
      required: info.requiresSasConfirmation,
      confirmed: !info.requiresSasConfirmation,
    };
    verificationRef.current = nextVerification;
    setVerification(nextVerification);

    connectionTimerRef.current?.clear();
    disconnectGraceTimerRef.current?.clear();
    actions.connected();
  };

  const handleConfirmVerification = () => {
    const current = verificationRef.current;
    if (!current.required || current.confirmed) return;

    const nextVerification = { ...current, confirmed: true };
    verificationRef.current = nextVerification;
    setVerification(nextVerification);
  };

  const handleRejectVerification = () => {
    const current = verificationRef.current;
    if (!current.required || current.confirmed) return;

    cleanupConnections();
    actions.fail(VERIFICATION_FAILED_MESSAGE);
  };

  // Initialize connection and grace timers once
  if (!connectionTimerRef.current) {
    connectionTimerRef.current = createConnectionTimer(20000, () => {
      if (statusRef.current === 'connecting' || statusRef.current === 'waiting') {
        cleanupConnections();
        actions.fail('Connection timed out');
      }
    });
  }

  if (!disconnectGraceTimerRef.current) {
    disconnectGraceTimerRef.current = createConnectionTimer(5000, () => {
      if (statusRef.current === 'connected') {
        handleDisconnect();
      }
    });
  }

  if (!transferConfirmationTimerRef.current) {
    transferConfirmationTimerRef.current = createConnectionTimer(30000, () => {
      if (transferStatusRef.current === 'awaiting_confirmation') {
        senderRef.current = null;
        transferActions.failTransfer('No confirmation received');
      }
    });
  }

  // ─── Data Channel Dispatcher (Text Chat + File Control + Binary Chunks) ─────
  const handleDataChannelMessage = async (data: string | ArrayBuffer) => {
    if (statusRef.current !== 'connected' && statusRef.current !== 'connecting') return;

    if (!verificationRef.current.confirmed) {
      if (typeof data === 'string') {
        try {
          const parsed = ControlMessageSchema.safeParse(JSON.parse(data));
          if (parsed.success && parsed.data.type === 'file-offer') {
            peerRef.current?.sendData(
              PlaintextTransportCodec.encodeControl({
                type: 'file-decline',
                id: parsed.data.id,
                reason: 'The other device has not finished verification yet',
              }),
            );
          }
        } catch (err) {
          console.error('[Verification Gate Error]', err);
        }
      }
      return;
    }
    if (statusRef.current !== 'connected') return;

    // 1. Binary message -> forward to active FileReceiver
    if (data instanceof ArrayBuffer) {
      if (receiverRef.current) {
        await receiverRef.current.receiveChunk(data);
      }
      return;
    }

    // 2. String message -> try parsing as JSON ControlMessage
    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data);
        const controlParsed = ControlMessageSchema.safeParse(parsed);
        if (controlParsed.success) {
          const msg: ControlMessage = controlParsed.data;

          switch (msg.type) {
            case 'file-offer': {
              // Only 1 transfer at a time: reject if active
              if (transferStatusRef.current !== 'idle') {
                const declineMsg = PlaintextTransportCodec.encodeControl({
                  type: 'file-decline',
                  id: msg.id,
                  reason: 'Receiver is currently busy with another transfer',
                });
                peerRef.current?.sendData(declineMsg);
                return;
              }

              // Sanitize filename on offer
              const sanitizedOffer = {
                ...msg,
                name: sanitizeFilename(msg.name),
              };
              transferActions.offerIncoming(sanitizedOffer);
              return;
            }

            case 'file-accept': {
              // Sender receives accept -> begin streaming
              if (senderRef.current && transferStatusRef.current === 'transferring') {
                senderRef.current.start();
              }
              return;
            }

            case 'file-ack': {
              const sender = senderRef.current;
              if (sender && sender.getOffer().id === msg.id && sender.handleAck(msg.bytes)) {
                transferConfirmationTimerRef.current?.start();
              }
              return;
            }

            case 'file-decline': {
              senderRef.current?.cancel(msg.reason || 'Receiver declined transfer');
              senderRef.current = null;
              transferActions.failTransfer(`Transfer declined: ${msg.reason || 'Receiver declined'}`);
              return;
            }

            case 'file-end': {
              if (receiverRef.current) {
                transferActions.beginVerifying();
                await receiverRef.current.finish(msg);
              }
              return;
            }

            case 'file-result': {
              const transferStatus = transferStatusRef.current;
              const sender = senderRef.current;
              if (
                !sender ||
                (transferStatus !== 'transferring' && transferStatus !== 'awaiting_confirmation') ||
                sender.getOffer().id !== msg.id
              ) {
                return;
              }

              transferConfirmationTimerRef.current?.clear();
              transferActions.fileResult(msg.id, msg.ok, msg.error);
              senderRef.current = null;
              return;
            }

            case 'file-cancel': {
              senderRef.current?.cancel(msg.reason || 'Cancelled by peer');
              senderRef.current = null;
              receiverRef.current?.cancel(msg.reason || 'Cancelled by peer');
              receiverRef.current = null;
              transferActions.cancelTransfer();
              return;
            }

            case 'text': {
              // Plain text chat message capped at 4000 characters
              actions.addMessage('peer', msg.body.slice(0, 4000));
              return;
            }
          }
        }
      } catch {
        // Plain string fallback for simple text chat
        actions.addMessage('peer', data.slice(0, 4000));
      }
    }
  };

  const setupPeerConnectionEvents = (attempt: number) => {
    const isCurrentAttempt = () => connectionAttemptRef.current === attempt;

    return {
      onDataChannelClose: () => {
        if (!isCurrentAttempt()) return;
        if (
          statusRef.current === 'idle' ||
          statusRef.current === 'closed' ||
          statusRef.current === 'failed'
        ) {
          return;
        }
        if (transferStatusRef.current === 'awaiting_confirmation') {
          transferConfirmationTimerRef.current?.clear();
          senderRef.current = null;
          transferActions.failTransfer('No confirmation received');
          return;
        }
        handleDisconnect();
      },
      onMessage: (data: string | ArrayBuffer) => {
        if (!isCurrentAttempt()) return;
        handleDataChannelMessage(data);
      },
      onConnectionStateChange: (pcState: RTCPeerConnectionState) => {
        if (!isCurrentAttempt()) return;
        if (
          statusRef.current === 'idle' ||
          statusRef.current === 'closed' ||
          statusRef.current === 'failed'
        ) {
          return;
        }

        if (pcState === 'connected') {
          disconnectGraceTimerRef.current?.clear();
        } else if (pcState === 'failed') {
          cleanupConnections();
          actions.fail(
            'Could not establish a direct connection (the network may be blocking peer-to-peer)',
          );
        } else if (pcState === 'disconnected') {
          disconnectGraceTimerRef.current?.start();
        } else if (pcState === 'closed') {
          handleDisconnect();
        }
      },
      onError: (err: unknown) => {
        if (!isCurrentAttempt()) return;
        if (
          statusRef.current === 'idle' ||
          statusRef.current === 'closed' ||
          statusRef.current === 'failed'
        ) {
          return;
        }
        console.error('[WebRTC Error]');
        cleanupConnections();
        actions.fail(
          err instanceof SecureChannelError
            ? err.message === 'Key confirmation failed'
              ? PAIRING_MODE_MISMATCH_MESSAGE
              : `Secure connection failed: ${err.message}`
            : 'WebRTC connection failed',
        );
      },
    };
  };

  // ─── 1. Initiator: Create Session Flow ────────────────────────────────────────
  const handleStartCreate = async () => {
    cleanupConnections();
    const attempt = connectionAttemptRef.current;
    setSignalingPending(false);
    pairingSecretRef.current = generatePairingSecret();
    setSendError(null);
    actions.startCreate();

    const sig = new SignalingClient();
    signalingRef.current = sig;
    sig.onPending(() => {
      if (connectionAttemptRef.current === attempt && signalingRef.current === sig) {
        setSignalingPending(true);
      }
    });

    try {
      await sig.connect();
      if (connectionAttemptRef.current !== attempt || signalingRef.current !== sig) return;
      setSignalingPending(false);

      sig.onMessage((msg) => {
        if (connectionAttemptRef.current !== attempt || signalingRef.current !== sig) return;
        if (msg.type === 'created') {
          actions.created(msg.code);
        } else if (msg.type === 'peer-joined') {
          actions.peerFound();
          connectionTimerRef.current?.start();

          const callbacks = setupPeerConnectionEvents(attempt);

          const peer = new PeerManager({
            signaling: sig,
            isInitiator: true,
            psk:
              msg.pairingMethod === 'qr'
                ? pairingSecretRef.current ?? undefined
                : undefined,
            onSecureReady: (info) => {
              if (connectionAttemptRef.current === attempt) handleSecureReady(info);
            },
            ...callbacks,
          });

          peerRef.current = peer;
          peer.startOffer().catch(() => {
            if (connectionAttemptRef.current !== attempt || peerRef.current !== peer) return;
            console.error('[WebRTC startOffer Error]');
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
        if (connectionAttemptRef.current !== attempt || signalingRef.current !== sig) return;
        if (statusRef.current === 'waiting' || statusRef.current === 'connecting') {
          cleanupConnections();
          actions.fail('Disconnected from signaling server');
        }
      });

      sig.send({ type: 'create' });
    } catch {
      if (connectionAttemptRef.current !== attempt || signalingRef.current !== sig) return;
      console.warn('[signaling] connection failed');
      setSignalingPending(false);
      cleanupConnections();
      actions.fail(SIGNALING_UNREACHABLE_MESSAGE);
    }
  };

  // ─── 2. Responder: Join Session Flow ──────────────────────────────────────────
  const handleStartJoin = async (inputCode: string, psk?: Uint8Array) => {
    cleanupConnections();
    const attempt = connectionAttemptRef.current;
    setSignalingPending(false);
    pairingSecretRef.current = psk ?? null;
    setSendError(null);
    actions.startJoin(inputCode);

    const sig = new SignalingClient();
    signalingRef.current = sig;
    sig.onPending(() => {
      if (connectionAttemptRef.current === attempt && signalingRef.current === sig) {
        setSignalingPending(true);
      }
    });

    try {
      await sig.connect();
      if (connectionAttemptRef.current !== attempt || signalingRef.current !== sig) return;
      setSignalingPending(false);

      sig.onMessage((msg) => {
        if (connectionAttemptRef.current !== attempt || signalingRef.current !== sig) return;
        if (msg.type === 'joined') {
          connectionTimerRef.current?.start();

          const callbacks = setupPeerConnectionEvents(attempt);

          const peer = new PeerManager({
            signaling: sig,
            isInitiator: false,
            psk: pairingSecretRef.current ?? undefined,
            onSecureReady: (info) => {
              if (connectionAttemptRef.current === attempt) handleSecureReady(info);
            },
            ...callbacks,
          });

          peerRef.current = peer;
        } else if (msg.type === 'error') {
          cleanupConnections();
          actions.fail(msg.reason);
        } else if (msg.type === 'peer-closed') {
          handleDisconnect();
        }
      });

      sig.onDisconnect(() => {
        if (connectionAttemptRef.current !== attempt || signalingRef.current !== sig) return;
        if (statusRef.current === 'connecting') {
          cleanupConnections();
          actions.fail('Disconnected from signaling server');
        }
      });

      sig.send({
        type: 'join',
        code: inputCode,
        pairingMethod: psk ? 'qr' : 'code',
      });
    } catch {
      if (connectionAttemptRef.current !== attempt || signalingRef.current !== sig) return;
      console.warn('[signaling] connection failed');
      setSignalingPending(false);
      cleanupConnections();
      actions.fail(SIGNALING_UNREACHABLE_MESSAGE);
    }
  };

  const joinRef = useRef(handleStartJoin);
  joinRef.current = handleStartJoin;

  useEffect(() => {
    if (!initialPairing) return;
    const timer = window.setTimeout(() => {
      scrubPairingFragment();
      void joinRef.current(initialPairing.code, initialPairing.psk);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialPairing]);

  // ─── 3. File Transfer Actions ────────────────────────────────────────────────
  const handleSelectFile = (file: File) => {
    if (!verificationRef.current.confirmed) {
      setSendError('Verify the connection first');
      return;
    }
    if (!peerRef.current || statusRef.current !== 'connected') {
      setSendError('Cannot send file: not connected');
      return;
    }
    const channel = peerRef.current.getTransferChannel();
    if (!channel || channel.readyState !== 'open') {
      setSendError('Cannot start transfer: the secure data channel is unavailable');
      return;
    }

    const sender = new FileSender({
      file,
      dataChannel: channel,
      codec: PlaintextTransportCodec,
      onProgress: (p) => {
        transferActions.updateProgress(p);
      },
      onError: (err) => {
        transferConfirmationTimerRef.current?.clear();
        transferActions.failTransfer(err.message);
        senderRef.current = null;
      },
      onCompleted: () => {
        transferConfirmationTimerRef.current?.clear();
        transferActions.awaitConfirmation();
        if (
          senderRef.current === sender &&
          transferStatusRef.current !== 'completed' &&
          transferStatusRef.current !== 'failed'
        ) {
          transferConfirmationTimerRef.current?.start();
        }
      },
    });

    senderRef.current = sender;
    const offer = sender.getOffer();
    transferActions.startSending(offer);

    // Send file-offer control message over data channel
    const encodedOffer = PlaintextTransportCodec.encodeControl(offer);
    peerRef.current.sendData(encodedOffer);
  };

  const handleAcceptTransfer = async () => {
    if (!transferState.offer || !peerRef.current) return;
    const offer = transferState.offer;
    const peer = peerRef.current;
    const attempt = connectionAttemptRef.current;

    let writableStream: WritableStreamDefaultWriter<Uint8Array> | null = null;

    // Chromium File System Access API check (user gesture is this button click)
    if (typeof window !== 'undefined' && 'showSaveFilePicker' in window) {
      try {
        const fileHandle = await window.showSaveFilePicker!({
          suggestedName: offer.name,
        });
        const writable = await fileHandle.createWritable();
        writableStream = writable.getWriter();
      } catch (err: unknown) {
        // If user cancelled save dialog -> decline and do not start
        if ((err as { name?: string })?.name === 'AbortError') {
          const declineMsg = PlaintextTransportCodec.encodeControl({
            type: 'file-decline',
            id: offer.id,
            reason: 'User cancelled save dialog',
          });
          if (peerRef.current === peer && connectionAttemptRef.current === attempt) {
            peer.sendData(declineMsg);
            if (
              transferStatusRef.current === 'offered' &&
              transferOfferRef.current?.id === offer.id
            ) {
              transferActions.resetTransfer();
            }
          }
          return;
        }
        console.warn('showSaveFilePicker failed; using the in-memory download fallback');
      }
    }

    if (
      peerRef.current !== peer ||
      connectionAttemptRef.current !== attempt ||
      transferStatusRef.current !== 'offered' ||
      transferOfferRef.current?.id !== offer.id
    ) {
      return;
    }

    transferActions.acceptTransfer();

    const receiver = new FileReceiver({
      offer,
      codec: PlaintextTransportCodec,
      writableStream,
      onProgress: (p) => {
        transferActions.updateProgress(p);
      },
      onAck: (bytes) => {
        try {
          peerRef.current?.sendData(
            PlaintextTransportCodec.encodeControl({
              type: 'file-ack',
              id: offer.id,
              bytes,
            }),
          );
        } catch {
          // The data channel may close while acknowledging a chunk.
        }
      },
      onError: (err) => {
        try {
          if (peerRef.current) {
            peerRef.current.sendData(
              PlaintextTransportCodec.encodeControl({
                type: 'file-result',
                id: offer.id,
                ok: false,
                error: err.message,
              }),
            );
          }
        } catch {
          // ignore closed channel failure
        }
        transferActions.failTransfer(err.message);
        receiverRef.current = null;
      },
      onCompleted: (blob) => {
        try {
          if (peerRef.current) {
            peerRef.current.sendData(
              PlaintextTransportCodec.encodeControl({
                type: 'file-result',
                id: offer.id,
                ok: true,
              }),
            );
          }
        } catch {
          // ignore closed channel failure
        }
        transferActions.completeTransfer(blob);
        receiverRef.current = null;
      },
    });

    receiverRef.current = receiver;

    // Send file-accept message
    const acceptMsg = PlaintextTransportCodec.encodeControl({
      type: 'file-accept',
      id: offer.id,
    });
    peer.sendData(acceptMsg);
  };

  const handleDeclineTransfer = () => {
    if (!transferState.offer || !peerRef.current) return;
    const declineMsg = PlaintextTransportCodec.encodeControl({
      type: 'file-decline',
      id: transferState.offer.id,
      reason: 'Receiver declined',
    });
    peerRef.current.sendData(declineMsg);
    transferActions.resetTransfer();
  };

  const handleCancelTransfer = () => {
    if (senderRef.current) {
      senderRef.current.cancel('Sender cancelled');
      senderRef.current = null;
    }
    if (receiverRef.current) {
      receiverRef.current.cancel('Receiver cancelled');
      receiverRef.current = null;
    }
    if (peerRef.current && transferState.offer) {
      const cancelMsg = PlaintextTransportCodec.encodeControl({
        type: 'file-cancel',
        id: transferState.offer.id,
        reason: 'Transfer cancelled by peer',
      });
      peerRef.current.sendData(cancelMsg);
    }
    transferActions.cancelTransfer();
  };

  // ─── 4. Plaintext Chat Messaging ─────────────────────────────────────────────
  const handleSendMessage = (text: string) => {
    setSendError(null);
    const trimmed = text.trim();
    if (!trimmed) return;

    if (!verificationRef.current.confirmed) {
      setSendError('Verify the connection first');
      return;
    }

    if (!peerRef.current || statusRef.current !== 'connected') {
      setSendError('Cannot send: data channel is not connected');
      return;
    }

    try {
      const chatMsg: ControlMessage = {
        type: 'text',
        body: trimmed.slice(0, 4000),
      };
      const encoded = PlaintextTransportCodec.encodeControl(chatMsg);
      peerRef.current.sendData(encoded);
      actions.addMessage('self', trimmed);
    } catch {
      console.error('[Send Message Error]');
      setSendError('Failed to send message. Check the connection and try again.');
    }
  };

  const pairingUrl =
    state.code && pairingSecretRef.current
      ? buildPairingUrl(
          window.location.origin + window.location.pathname,
          state.code,
          pairingSecretRef.current,
        )
      : null;

  // Clean up on component unmount
  useEffect(() => {
    return () => {
      cleanupConnections();
    };
  }, []);

  return (
    <div className={styles.pageBackdrop}>
      <main className={styles.frame}>
        {(needRefresh || updateError) && (
          <div className={styles.updateNotice} role={updateError ? 'alert' : 'status'}>
            {updateError ? (
              <span>Could not check for app updates. The app is still available to use.</span>
            ) : isSessionActive ? (
              <span>An app update is ready. It can be installed after this session ends.</span>
            ) : (
              <>
                <span>An app update is ready to install.</span>
                <button
                  type="button"
                  className={styles.updateButton}
                  onClick={handleApplyUpdate}
                >
                  Refresh to update
                </button>
              </>
            )}
          </div>
        )}
        <section id="hero" className={styles.heroPanel}>
          <DecorativeTiles />
          <NavBar
            onStartSession={() => handleStartCreate()}
            isDark={isDark}
            onToggleTheme={handleToggleTheme}
          />

          <header className={styles.heroHeader}>
            <h1 className={styles.headline}>Send big files, skip the cloud.</h1>
            <p className={styles.subtext}>
              {/* TODO: Restore encryption wording after Phase 5. */}
              Direct from your device to theirs. No accounts, no uploads.
            </p>
          </header>

          <div className={styles.heroContent}>
            {state.status === 'idle' && (
              <PairingCards
                onCreateSession={() => handleStartCreate()}
                onJoinSession={handleStartJoin}
              />
            )}

            {state.status === 'waiting' && (
              <CreateScreen
                code={state.code}
                pairingUrl={pairingUrl}
                isWaking={signalingPending}
                onCancel={handleReset}
              />
            )}

            {((state.status === 'connecting' && state.role === 'responder') ||
              (state.status === 'failed' &&
                state.role === 'responder' &&
                state.error !== VERIFICATION_FAILED_MESSAGE &&
                state.error !== PAIRING_MODE_MISMATCH_MESSAGE &&
                state.error !== SIGNALING_UNREACHABLE_MESSAGE)) && (
              <JoinScreen
                onJoin={handleStartJoin}
                onCancel={handleReset}
                error={state.error}
                isConnecting={state.status === 'connecting' && Boolean(state.code)}
                isWaking={signalingPending}
              />
            )}

            {state.status === 'connecting' && state.role === 'initiator' && (
              <div className={styles.statusCardOuter}>
                <div className={styles.statusCardInner}>
                  <div className={styles.statusIcon} aria-hidden="true">
                    ⚡
                  </div>
                  <h2 className={styles.statusTitle}>Connecting...</h2>
                  <p className={styles.statusText} role="status" aria-live="polite">
                    Peer joined. Establishing direct WebRTC connection...
                  </p>
                  <button
                    className={styles.outlinedActionButton}
                    onClick={handleReset}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {state.status === 'connected' && (
              <ConnectedScreen
                role={state.role}
                verification={verification}
                onConfirmVerification={handleConfirmVerification}
                onRejectVerification={handleRejectVerification}
                messages={state.messages}
                onSendMessage={handleSendMessage}
                onDisconnect={handleDisconnect}
                sendError={sendError}
                transferState={transferState}
                onSelectFile={handleSelectFile}
                onAcceptTransfer={handleAcceptTransfer}
                onDeclineTransfer={handleDeclineTransfer}
                onCancelTransfer={handleCancelTransfer}
                onResetTransfer={transferActions.resetTransfer}
              />
            )}

            {((state.status === 'failed' &&
              (state.role !== 'responder' ||
                state.error === SIGNALING_UNREACHABLE_MESSAGE ||
                state.error === VERIFICATION_FAILED_MESSAGE ||
                state.error === PAIRING_MODE_MISMATCH_MESSAGE)) ||
              state.status === 'closed') && (
              <div className={styles.statusCardOuter}>
                <div className={styles.statusCardInner}>
                  <div className={styles.statusIcon} aria-hidden="true">
                    {state.status === 'failed' ? '⚠️' : '🔒'}
                  </div>
                  <h2 className={styles.statusTitle}>
                    {state.status === 'failed'
                      ? 'Connection Failed'
                      : 'Session Closed'}
                  </h2>
                  <p
                    className={styles.statusText}
                    role={state.status === 'failed' ? 'alert' : 'status'}
                    aria-live={state.status === 'failed' ? 'assertive' : 'polite'}
                  >
                    {state.error || 'The session was closed.'}
                  </p>
                  {state.status === 'failed' &&
                  (state.error === SIGNALING_UNREACHABLE_MESSAGE ||
                    state.error === 'Connection timed out' ||
                    state.error === 'Disconnected from signaling server') ? (
                    <button
                      className={styles.actionButton}
                      onClick={
                        state.role === 'initiator'
                          ? () => handleStartCreate()
                          : () =>
                              handleStartJoin(
                                state.code ?? '',
                                initialPairing?.code === state.code
                                  ? initialPairing.psk
                                  : undefined,
                              )
                      }
                      type="button"
                    >
                      Try again
                    </button>
                  ) : (
                    <button
                      className={styles.actionButton}
                      onClick={handleReset}
                      type="button"
                    >
                      Return Home
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>

        <LightSections />
      </main>
    </div>
  );
}
