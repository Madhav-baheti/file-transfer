import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PeerManager } from '../src/lib/peer';
import { SignalingClient } from '../src/lib/signaling';

// ─── Mock RTCPeerConnection & RTCDataChannel ───────────────────────────────────

class MockRTCDataChannel {
  public readyState = 'open';
  public onopen: (() => void) | null = null;
  public onclose: (() => void) | null = null;
  public onmessage: ((e: { data: unknown }) => void) | null = null;
  public onerror: ((err: unknown) => void) | null = null;
  public send = vi.fn();
  public close = vi.fn(() => {
    this.readyState = 'closed';
    // Emulate browser event if handler is still attached
    this.onclose?.();
  });
}

class MockRTCPeerConnection {
  public connectionState: RTCPeerConnectionState = 'new';
  public onconnectionstatechange: (() => void) | null = null;
  public onicecandidate: ((e: { candidate: unknown }) => void) | null = null;
  public ondatachannel: ((e: { channel: RTCDataChannel }) => void) | null = null;

  public setRemoteDescription = vi.fn().mockResolvedValue(undefined);
  public setLocalDescription = vi.fn().mockResolvedValue(undefined);
  public createOffer = vi.fn().mockResolvedValue({ type: 'offer', sdp: 'mock-offer-sdp' });
  public createAnswer = vi.fn().mockResolvedValue({ type: 'answer', sdp: 'mock-answer-sdp' });
  public addIceCandidate = vi.fn().mockResolvedValue(undefined);
  public createDataChannel = vi.fn().mockReturnValue(new MockRTCDataChannel());
  public close = vi.fn();
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

  it('caps messages sent via send() to 4000 characters', () => {
    const peer = new PeerManager({
      signaling: mockSignaling,
      isInitiator: true,
    });

    const channel = (peer as unknown as { channel: MockRTCDataChannel }).channel;
    const longText = 'a'.repeat(5000);

    peer.send(longText);

    expect(channel.send).toHaveBeenCalledWith('a'.repeat(4000));
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
    expect(() => peer.send('test')).toThrow('PeerManager is closed');
  });
});
