import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PeerManager } from '../src/lib/peer';
import { SignalingClient } from '../src/lib/signaling';

// ─── Mock RTCPeerConnection & RTCDataChannel ───────────────────────────────────

class MockRTCDataChannel {
  public readyState: RTCDataChannelState = 'connecting';
  public bufferedAmount = 0;
  public bufferedAmountLowThreshold = 0;
  public onopen: (() => void) | null = null;
  public onclose: (() => void) | null = null;
  public onmessage: ((e: { data: unknown }) => void) | null = null;
  public onerror: ((err: unknown) => void) | null = null;
  public peer: MockRTCDataChannel | null = null;
  private listeners = new Map<string, Set<EventListener>>();
  public send = vi.fn((data: string | ArrayBuffer | ArrayBufferView) => {
    queueMicrotask(() => this.peer?.onmessage?.({ data }));
  });
  public addEventListener = vi.fn((type: string, listener: EventListener) => {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  });
  public removeEventListener = vi.fn((type: string, listener: EventListener) => {
    this.listeners.get(type)?.delete(listener);
  });
  public open = () => {
    this.readyState = 'open';
    this.onopen?.();
  };
  public close = vi.fn(() => {
    this.readyState = 'closed';
    // Emulate browser event if handler is still attached
    this.onclose?.();
    for (const listener of this.listeners.get('close') ?? []) {
      listener(new Event('close'));
    }
  });
}

class MockRTCPeerConnection {
  public connectionState: RTCPeerConnectionState = 'new';
  public onconnectionstatechange: (() => void) | null = null;
  public onicecandidate: ((e: { candidate: unknown }) => void) | null = null;
  public ondatachannel: ((e: { channel: RTCDataChannel }) => void) | null = null;
  public localDescription: RTCSessionDescription | null = {
    type: 'offer',
    sdp: 'v=0\r\na=fingerprint:sha-256 AA:BB:CC:DD',
  } as RTCSessionDescription;
  public remoteDescription: RTCSessionDescription | null = {
    type: 'answer',
    sdp: 'v=0\r\na=fingerprint:sha-256 AA:BB:CC:DD',
  } as RTCSessionDescription;

  public setRemoteDescription = vi.fn().mockResolvedValue(undefined);
  public setLocalDescription = vi.fn().mockResolvedValue(undefined);
  public createOffer = vi.fn().mockResolvedValue({ type: 'offer', sdp: 'mock-offer-sdp' });
  public createAnswer = vi.fn().mockResolvedValue({ type: 'answer', sdp: 'mock-answer-sdp' });
  public addIceCandidate = vi.fn().mockResolvedValue(undefined);
  public createDataChannel = vi.fn().mockReturnValue(new MockRTCDataChannel());
  public close = vi.fn();
}

function createPeerPair(
  initiatorOptions: Partial<ConstructorParameters<typeof PeerManager>[0]> = {},
  responderOptions: Partial<ConstructorParameters<typeof PeerManager>[0]> = {},
) {
  const initiator = new PeerManager({
    signaling: mockSignalingForPair(),
    isInitiator: true,
    ...initiatorOptions,
  });
  const responder = new PeerManager({
    signaling: mockSignalingForPair(),
    isInitiator: false,
    ...responderOptions,
  });
  const initiatorPc = (initiator as unknown as { pc: MockRTCPeerConnection }).pc;
  const responderPc = (responder as unknown as { pc: MockRTCPeerConnection }).pc;
  const initiatorChannel = initiatorPc.createDataChannel.mock.results[0].value as MockRTCDataChannel;
  const responderChannel = new MockRTCDataChannel();
  initiatorChannel.peer = responderChannel;
  responderChannel.peer = initiatorChannel;
  responderPc.ondatachannel?.({ channel: responderChannel as unknown as RTCDataChannel });

  return {
    initiator,
    responder,
    initiatorChannel,
    responderChannel,
    initiatorPc,
    responderPc,
    open() {
      initiatorChannel.open();
      responderChannel.open();
    },
  };
}

function mockSignalingForPair(): SignalingClient {
  return {
    send: vi.fn(),
    onMessage: vi.fn(() => () => {}),
    close: vi.fn(),
  } as unknown as SignalingClient;
}

// Attach mocks to global scope for tests
// @ts-expect-error Mocking browser WebRTC APIs
globalThis.RTCPeerConnection = MockRTCPeerConnection;
// @ts-expect-error Mocking browser WebRTC APIs
globalThis.RTCSessionDescription = vi.fn((init) => init);
// @ts-expect-error Mocking browser WebRTC APIs
globalThis.RTCIceCandidate = vi.fn((init) => init);

describe('PeerManager Signaling & ICE Buffering', () => {
  let mockSignaling: SignalingClient;
  let signalHandler: ((msg: unknown) => void) | null = null;

  beforeEach(() => {
    mockSignaling = {
      send: vi.fn(),
      onMessage: vi.fn((handler) => {
        signalHandler = handler;
        return () => {
          signalHandler = null;
        };
      }),
      close: vi.fn(),
    } as unknown as SignalingClient;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('buffers early ICE candidates and flushes them only after setRemoteDescription completes', async () => {
    const peer = new PeerManager({
      signaling: mockSignaling,
      isInitiator: false,
    });

    const pcInstance = (peer as unknown as { pc: MockRTCPeerConnection }).pc;

    // 1. Send ICE candidate before remote description is set
    const earlyCandidate = {
      candidate: 'candidate:1 1 UDP 2122260223 192.168.1.1 50000 typ host',
      sdpMid: '0',
      sdpMLineIndex: 0,
    };

    signalHandler?.({
      type: 'signal',
      kind: 'ice',
      data: earlyCandidate,
    });

    // Allow promise chain tick
    await Promise.resolve();

    // addIceCandidate must NOT be called yet because remoteDescription is not set
    expect(pcInstance.addIceCandidate).not.toHaveBeenCalled();

    // 2. Deliver the offer to set remote description
    signalHandler?.({
      type: 'signal',
      kind: 'offer',
      data: {
        type: 'offer',
        sdp: 'v=0\r\no=mock...',
      },
    });

    // Wait for promise chain to resolve
    await (peer as unknown as { messageQueue: Promise<void> }).messageQueue;

    // setRemoteDescription should have completed
    expect(pcInstance.setRemoteDescription).toHaveBeenCalled();
    // Buffered ICE candidate must now have been flushed and added
    expect(pcInstance.addIceCandidate).toHaveBeenCalledWith(earlyCandidate);
  });

  it('drops invalid SDP payloads and reports an error via onError', async () => {
    const onError = vi.fn();
    const peer = new PeerManager({
      signaling: mockSignaling,
      isInitiator: false,
      onError,
    });

    // Deliver malformed offer (missing sdp field)
    signalHandler?.({
      type: 'signal',
      kind: 'offer',
      data: { type: 'offer' },
    });

    await (peer as unknown as { messageQueue: Promise<void> }).messageQueue;

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('sends an hs-commit on the raw channel when it opens', async () => {
    const peer = new PeerManager({
      signaling: mockSignaling,
      isInitiator: true,
    });
    const channel = (peer as unknown as { channel: MockRTCDataChannel }).channel;

    channel.open();
    await vi.waitFor(() => expect(channel.send).toHaveBeenCalled());

    expect(channel.send).toHaveBeenCalledWith(
      expect.stringMatching(/^\{"type":"hs-commit","commit":/),
    );
    peer.close();
  });

  it('starts the handshake when a message arrives before the open event', async () => {
    const onError = vi.fn();
    const peer = new PeerManager({
      signaling: mockSignaling,
      isInitiator: false,
      onError,
    });
    const pc = (peer as unknown as { pc: MockRTCPeerConnection }).pc;
    const channel = new MockRTCDataChannel();
    pc.ondatachannel?.({ channel: channel as unknown as RTCDataChannel });

    channel.readyState = 'open';
    channel.onmessage?.({
      data: '{"type":"hs-commit","commit":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}',
    });

    await vi.waitFor(() => {
      expect(channel.send).toHaveBeenCalledWith(
        expect.stringMatching(/^\{"type":"hs-hello","pub":/),
      );
    });
    expect(onError).not.toHaveBeenCalled();
    peer.close();
  });

  it('reports a wire error when the channel is not open', async () => {
    const onError = vi.fn();
    const peer = new PeerManager({
      signaling: mockSignaling,
      isInitiator: false,
      onError,
    });
    const pc = (peer as unknown as { pc: MockRTCPeerConnection }).pc;
    const channel = new MockRTCDataChannel();
    pc.ondatachannel?.({ channel: channel as unknown as RTCDataChannel });

    channel.onmessage?.({
      data: '{"type":"hs-commit","commit":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}',
    });

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'DataChannel is not open' }),
      );
    });
    expect(channel.send).not.toHaveBeenCalled();
  });

  it('rejects plaintext raw-channel application messages after open', async () => {
    const onError = vi.fn();
    const onMessage = vi.fn();
    const peer = new PeerManager({
      signaling: mockSignaling,
      isInitiator: true,
      onError,
      onMessage,
    });
    const channel = (peer as unknown as { channel: MockRTCDataChannel }).channel;
    channel.open();

    channel.onmessage?.({ data: '{"type":"text"}' });

    expect(onError).toHaveBeenCalledOnce();
    expect(onMessage).not.toHaveBeenCalled();
    expect(peer.isSecureReady).toBe(false);
  });

  it('does not allow sendData before secure readiness', () => {
    const peer = new PeerManager({
      signaling: mockSignaling,
      isInitiator: true,
    });

    expect(() => peer.sendData('plaintext')).toThrow('Secure channel is not ready');
    peer.close();
  });

  it('fails closed when a fingerprint is missing without sending plaintext', async () => {
    const onError = vi.fn();
    const peer = new PeerManager({
      signaling: mockSignaling,
      isInitiator: true,
      onError,
    });
    const pc = (peer as unknown as { pc: MockRTCPeerConnection }).pc;
    const channel = (peer as unknown as { channel: MockRTCDataChannel }).channel;
    pc.localDescription = null;

    channel.open();

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Could not read the connection fingerprint; refusing to continue unencrypted',
      }),
    );
    expect(channel.send).not.toHaveBeenCalled();
    expect(peer.isSecureReady).toBe(false);
    expect(peer.getTransferChannel()).toBeNull();
  });

  it('encrypts getTransferChannel sends before they reach the raw channel', async () => {
    const received = vi.fn();
    const pair = createPeerPair({}, { onMessage: received });
    pair.open();
    await vi.waitFor(() => {
      expect(pair.initiator.isSecureReady).toBe(true);
      expect(pair.responder.isSecureReady).toBe(true);
    });

    const transferChannel = pair.initiator.getTransferChannel();
    expect(transferChannel).not.toBeNull();
    const plaintext = 'secret application payload';
    transferChannel?.send(plaintext);

    await vi.waitFor(() => {
      expect(pair.initiatorChannel.send).toHaveBeenCalledWith(expect.any(ArrayBuffer));
    });
    const sentData = pair.initiatorChannel.send.mock.calls.at(-1)?.[0];
    expect(sentData).toBeInstanceOf(ArrayBuffer);
    expect(new TextDecoder().decode(sentData as ArrayBuffer)).not.toBe(plaintext);

    pair.initiator.send('a'.repeat(5000));
    await vi.waitFor(() => expect(received).toHaveBeenCalledTimes(2));
    expect(received).toHaveBeenLastCalledWith('a'.repeat(4000));

    pair.initiator.close();
    pair.responder.close();
  });

  it('close() does not trigger onDataChannelClose or onError afterwards, and ignores incoming signals', async () => {
    const onDataChannelClose = vi.fn();
    const onError = vi.fn();
    const onConnectionStateChange = vi.fn();
    const onMessage = vi.fn();

    const peer = new PeerManager({
      signaling: mockSignaling,
      isInitiator: true,
      onDataChannelClose,
      onError,
      onConnectionStateChange,
      onMessage,
    });

    const pcInstance = (peer as unknown as { pc: MockRTCPeerConnection }).pc;

    // Close the peer manager
    peer.close();

    // Verify close() was called on pc
    expect(pcInstance.close).toHaveBeenCalled();

    // Ensure callbacks did not fire during or after close
    expect(onDataChannelClose).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onConnectionStateChange).not.toHaveBeenCalled();

    // Verify that signaling messages arriving after close are ignored
    signalHandler?.({
      type: 'signal',
      kind: 'offer',
      data: { type: 'offer', sdp: 'mock-sdp' },
    });

    await Promise.resolve();

    // setRemoteDescription must NOT be called because manager is closed
    expect(pcInstance.setRemoteDescription).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();

    // Calling send() on closed manager throws
    expect(() => peer.send('test')).toThrow('Secure channel is not ready');
  });
});
