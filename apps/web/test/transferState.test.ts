import { describe, it, expect } from 'vitest';
import {
  transferReducer,
  initialTransferState,
  type TransferState,
} from '../src/lib/transferState';
import type { FileOfferMsg } from '../src/lib/protocol';

describe('transferReducer Guards', () => {
  const mockOffer: FileOfferMsg = {
    type: 'file-offer',
    id: 'test-file-123456',
    name: 'document.pdf',
    size: 1024 * 1024,
    mime: 'application/pdf',
  };

  it('starts in initial idle state', () => {
    expect(initialTransferState).toEqual({
      status: 'idle',
      direction: null,
      offer: null,
      progress: null,
      error: null,
      completedBlob: null,
    });
  });

  it('handles OFFER_INCOMING and transitions to offered state when idle', () => {
    const next = transferReducer(initialTransferState, {
      type: 'OFFER_INCOMING',
      offer: mockOffer,
    });
    expect(next.status).toBe('offered');
    expect(next.direction).toBe('receiver');
    expect(next.offer).toEqual(mockOffer);
  });

  it('guard: rejects OFFER_INCOMING if another transfer is active', () => {
    const activeState: TransferState = {
      ...initialTransferState,
      status: 'transferring',
      direction: 'sender',
      offer: mockOffer,
    };

    const newOffer: FileOfferMsg = {
      ...mockOffer,
      id: 'other-file-id',
      name: 'other.png',
    };

    const next = transferReducer(activeState, {
      type: 'OFFER_INCOMING',
      offer: newOffer,
    });
    // Must remain on existing active transfer and reject new offer
    expect(next.status).toBe('transferring');
    expect(next.offer?.id).toBe('test-file-123456');
  });

  it('guard: ACCEPT_TRANSFER is only valid from offered state', () => {
    const fromIdle = transferReducer(initialTransferState, { type: 'ACCEPT_TRANSFER' });
    expect(fromIdle.status).toBe('idle');

    const offeredState: TransferState = {
      ...initialTransferState,
      status: 'offered',
      direction: 'receiver',
      offer: mockOffer,
    };

    const accepted = transferReducer(offeredState, { type: 'ACCEPT_TRANSFER' });
    expect(accepted.status).toBe('transferring');
  });

  it('guard: UPDATE_PROGRESS and COMPLETE_TRANSFER only valid when transferring', () => {
    const progress = {
      fileId: mockOffer.id,
      filename: mockOffer.name,
      totalBytes: mockOffer.size,
      transferredBytes: 500,
      percentage: 50,
      speedBytesPerSec: 1000,
      etaSeconds: 5,
    };

    const fromIdle = transferReducer(initialTransferState, {
      type: 'UPDATE_PROGRESS',
      progress,
    });
    expect(fromIdle.status).toBe('idle');
    expect(fromIdle.progress).toBeNull();

    const transferringState: TransferState = {
      ...initialTransferState,
      status: 'transferring',
      direction: 'receiver',
      offer: mockOffer,
    };

    const updated = transferReducer(transferringState, {
      type: 'UPDATE_PROGRESS',
      progress,
    });
    expect(updated.status).toBe('transferring');
    expect(updated.progress).toEqual(progress);

    const completed = transferReducer(updated, {
      type: 'COMPLETE_TRANSFER',
    });
    expect(completed.status).toBe('completed');
  });

  it('guard: CANCEL_TRANSFER only valid from offered or transferring', () => {
    const fromIdle = transferReducer(initialTransferState, { type: 'CANCEL_TRANSFER' });
    expect(fromIdle.status).toBe('idle');

    const transferringState: TransferState = {
      ...initialTransferState,
      status: 'transferring',
      direction: 'sender',
      offer: mockOffer,
    };

    const cancelled = transferReducer(transferringState, { type: 'CANCEL_TRANSFER' });
    expect(cancelled.status).toBe('cancelled');
  });

  it('guard: FAIL_TRANSFER is ignored if already completed or cancelled', () => {
    const completedState: TransferState = {
      ...initialTransferState,
      status: 'completed',
    };

    const next = transferReducer(completedState, {
      type: 'FAIL_TRANSFER',
      error: 'Late error',
    });
    expect(next.status).toBe('completed');
    expect(next.error).toBeNull();
  });
});
