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

    const senderAwaiting = transferReducer(initialTransferState, {
      type: 'START_SENDING',
      offer: mockOffer,
    });
    expect(senderAwaiting.status).toBe('awaiting_acceptance');
    expect(
      transferReducer(senderAwaiting, { type: 'UPDATE_PROGRESS', progress: {
        fileId: mockOffer.id,
        filename: mockOffer.name,
        totalBytes: mockOffer.size,
        transferredBytes: 0,
        percentage: 0,
        speedBytesPerSec: 0,
        etaSeconds: 0,
      } }),
    ).toBe(senderAwaiting);
    expect(transferReducer(senderAwaiting, { type: 'ACCEPT_TRANSFER' }).status).toBe(
      'transferring',
    );
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

  it('guard: AWAIT_CONFIRMATION is only valid from transferring sender after file-end', () => {
    const fromIdle = transferReducer(initialTransferState, { type: 'AWAIT_CONFIRMATION' });
    expect(fromIdle.status).toBe('idle');

    const senderState: TransferState = {
      ...initialTransferState,
      status: 'transferring',
      direction: 'sender',
      offer: mockOffer,
    };

    const awaiting = transferReducer(senderState, { type: 'AWAIT_CONFIRMATION' });
    expect(awaiting.status).toBe('awaiting_confirmation');
  });

  it('begins verification only for a receiving transfer in progress', () => {
    const receiverState: TransferState = {
      ...initialTransferState,
      status: 'transferring',
      direction: 'receiver',
      offer: mockOffer,
    };
    const senderState = { ...receiverState, direction: 'sender' as const };
    const offeredState = { ...receiverState, status: 'offered' as const };

    expect(transferReducer(receiverState, { type: 'BEGIN_VERIFYING' }).status).toBe('verifying');
    expect(transferReducer(senderState, { type: 'BEGIN_VERIFYING' })).toBe(senderState);
    expect(transferReducer(offeredState, { type: 'BEGIN_VERIFYING' })).toBe(offeredState);
    expect(transferReducer(initialTransferState, { type: 'BEGIN_VERIFYING' })).toBe(initialTransferState);
  });

  it('allows a verifying receiver to complete, fail, or cancel', () => {
    const verifyingState: TransferState = {
      ...initialTransferState,
      status: 'verifying',
      direction: 'receiver',
      offer: mockOffer,
    };

    expect(transferReducer(verifyingState, { type: 'COMPLETE_TRANSFER' }).status).toBe('completed');

    const failed = transferReducer(verifyingState, {
      type: 'FAIL_TRANSFER',
      error: 'Hash verification failed',
    });
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('Hash verification failed');

    expect(transferReducer(verifyingState, { type: 'CANCEL_TRANSFER' }).status).toBe('cancelled');
  });

  it('ignores verification and completion from unrelated states', () => {
    const idleComplete = transferReducer(initialTransferState, { type: 'COMPLETE_TRANSFER' });
    expect(idleComplete).toBe(initialTransferState);

    const senderTransferring: TransferState = {
      ...initialTransferState,
      status: 'transferring',
      direction: 'sender',
      offer: mockOffer,
    };
    expect(transferReducer(senderTransferring, { type: 'BEGIN_VERIFYING' })).toBe(senderTransferring);
    expect(transferReducer(senderTransferring, { type: 'COMPLETE_TRANSFER' })).toBe(senderTransferring);

    const idleReceiver: TransferState = {
      ...initialTransferState,
      direction: 'receiver',
    };
    expect(transferReducer(idleReceiver, { type: 'BEGIN_VERIFYING' })).toBe(idleReceiver);
  });

  it('handles FILE_RESULT success and ignores mismatched IDs', () => {
    const awaitingState: TransferState = {
      ...initialTransferState,
      status: 'awaiting_confirmation',
      direction: 'sender',
      offer: mockOffer,
      progress: {
        fileId: mockOffer.id,
        filename: mockOffer.name,
        totalBytes: mockOffer.size,
        transferredBytes: mockOffer.size,
        percentage: 100,
        speedBytesPerSec: 512,
        etaSeconds: 0,
      },
    };

    const success = transferReducer(awaitingState, {
      type: 'FILE_RESULT',
      id: mockOffer.id,
      ok: true,
    });
    expect(success.status).toBe('completed');
    expect(success.error).toBeNull();

    const mismatch = transferReducer(awaitingState, {
      type: 'FILE_RESULT',
      id: 'different-file-id',
      ok: false,
      error: 'Not my transfer',
    });
    expect(mismatch.status).toBe('awaiting_confirmation');

    const failed = transferReducer(awaitingState, {
      type: 'FILE_RESULT',
      id: mockOffer.id,
      ok: false,
      error: 'Receiver rejected the file',
    });
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('Receiver rejected the file');
  });

  it('ignores FILE_RESULT until the sender has sent file-end and awaits confirmation', () => {
    const transferringSender: TransferState = {
      ...initialTransferState,
      status: 'transferring',
      direction: 'sender',
      offer: mockOffer,
    };

    const completed = transferReducer(transferringSender, {
      type: 'FILE_RESULT',
      id: mockOffer.id,
      ok: true,
    });
    expect(completed).toBe(transferringSender);

    const failed = transferReducer(transferringSender, {
      type: 'FILE_RESULT',
      id: mockOffer.id,
      ok: false,
      error: 'Receiver reported a write failure',
    });
    expect(failed).toBe(transferringSender);

    const receiver: TransferState = { ...transferringSender, direction: 'receiver' };
    expect(
      transferReducer(receiver, {
        type: 'FILE_RESULT',
        id: mockOffer.id,
        ok: true,
      }),
    ).toBe(receiver);

    expect(
      transferReducer(transferringSender, {
        type: 'FILE_RESULT',
        id: 'different-file-id',
        ok: true,
      }),
    ).toBe(transferringSender);
  });

  it('ignores AWAIT_CONFIRMATION after sender completion', () => {
    const completedSender: TransferState = {
      ...initialTransferState,
      status: 'completed',
      direction: 'sender',
      offer: mockOffer,
    };

    expect(
      transferReducer(completedSender, { type: 'AWAIT_CONFIRMATION' }),
    ).toBe(completedSender);
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
      error: 'Old error',
    };

    const next = transferReducer(completedState, {
      type: 'FAIL_TRANSFER',
      error: 'Late error',
    });
    expect(next.status).toBe('completed');
    expect(next.error).toBe('Old error');
  });

  it('clears stale transfer metadata on completion and cancellation', () => {
    const failedState: TransferState = {
      ...initialTransferState,
      status: 'transferring',
      direction: 'receiver',
      offer: mockOffer,
      progress: {
        fileId: mockOffer.id,
        filename: mockOffer.name,
        totalBytes: mockOffer.size,
        transferredBytes: 50,
        percentage: 50,
        speedBytesPerSec: 10,
        etaSeconds: 1,
      },
      error: 'Temporary failure',
    };

    const completed = transferReducer(failedState, { type: 'COMPLETE_TRANSFER' });
    expect(completed.status).toBe('completed');
    expect(completed.error).toBeNull();
    expect(completed.progress).toBeNull();

    const cancelled = transferReducer(
      {
        ...completed,
        status: 'offered',
        direction: 'receiver',
        offer: mockOffer,
      },
      { type: 'CANCEL_TRANSFER' },
    );
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.error).toBeNull();
    expect(cancelled.progress).toBeNull();
    expect(cancelled.completedBlob).toBeNull();
  });
});
