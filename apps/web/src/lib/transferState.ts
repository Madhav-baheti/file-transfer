import { useReducer, useMemo } from 'react';
import type { FileOfferMsg } from './protocol';
import type { TransferProgress } from './transfer';

export type TransferStateKind =
  | 'idle'
  | 'offered'
  | 'transferring'
  | 'verifying'
  | 'awaiting_confirmation'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface TransferState {
  status: TransferStateKind;
  direction: 'sender' | 'receiver' | null;
  offer: FileOfferMsg | null;
  progress: TransferProgress | null;
  error: string | null;
  completedBlob: Blob | null;
}

export type TransferAction =
  | { type: 'OFFER_INCOMING'; offer: FileOfferMsg }
  | { type: 'START_SENDING'; offer: FileOfferMsg }
  | { type: 'ACCEPT_TRANSFER' }
  | { type: 'UPDATE_PROGRESS'; progress: TransferProgress }
  | { type: 'BEGIN_VERIFYING' }
  | { type: 'AWAIT_CONFIRMATION' }
  | { type: 'FILE_RESULT'; id: string; ok: boolean; error?: string }
  | { type: 'COMPLETE_TRANSFER'; blob?: Blob }
  | { type: 'FAIL_TRANSFER'; error: string }
  | { type: 'CANCEL_TRANSFER' }
  | { type: 'RESET_TRANSFER' };

export const initialTransferState: TransferState = {
  status: 'idle',
  direction: null,
  offer: null,
  progress: null,
  error: null,
  completedBlob: null,
};

/**
 * Pure reducer for file transfer state machine with transition guards:
 * - Only 1 transfer at a time: OFFER_INCOMING and START_SENDING are rejected if not idle
 * - ACCEPT_TRANSFER is only valid from 'offered'
 * - UPDATE_PROGRESS is only valid from 'transferring'
 * - BEGIN_VERIFYING is only valid from 'transferring' for receiver
 * - AWAIT_CONFIRMATION is only valid from 'transferring' for sender
 * - COMPLETE_TRANSFER is valid from 'awaiting_confirmation' (sender) or 'transferring'/'verifying' (receiver)
 * - CANCEL_TRANSFER is valid from 'offered', 'transferring', 'verifying', or 'awaiting_confirmation'
 * - FAIL_TRANSFER is ignored if already completed or cancelled
 */
export function transferReducer(state: TransferState, action: TransferAction): TransferState {
  switch (action.type) {
    case 'OFFER_INCOMING': {
      if (state.status !== 'idle') {
        return state; // Reject offer while a transfer is active
      }
      return {
        ...state,
        status: 'offered',
        direction: 'receiver',
        offer: action.offer,
        progress: null,
        error: null,
        completedBlob: null,
      };
    }

    case 'START_SENDING': {
      if (state.status !== 'idle') {
        return state;
      }
      return {
        ...state,
        status: 'transferring',
        direction: 'sender',
        offer: action.offer,
        progress: null,
        error: null,
        completedBlob: null,
      };
    }

    case 'ACCEPT_TRANSFER': {
      if (state.status !== 'offered') {
        return state;
      }
      return {
        ...state,
        status: 'transferring',
        error: null,
        progress: null,
      };
    }

    case 'UPDATE_PROGRESS': {
      if (state.status !== 'transferring') {
        return state;
      }
      return {
        ...state,
        progress: action.progress,
        error: null,
      };
    }

    case 'BEGIN_VERIFYING': {
      if (state.status !== 'transferring' || state.direction !== 'receiver') {
        return state;
      }
      return {
        ...state,
        status: 'verifying',
        error: null,
        progress: null,
      };
    }

    case 'AWAIT_CONFIRMATION': {
      if (state.status !== 'transferring' || state.direction !== 'sender') {
        return state;
      }
      return {
        ...state,
        status: 'awaiting_confirmation',
        error: null,
        progress: null,
      };
    }

    case 'FILE_RESULT': {
      if (
        state.direction !== 'sender' ||
        (state.status !== 'transferring' && state.status !== 'awaiting_confirmation') ||
        state.offer?.id !== action.id
      ) {
        return state;
      }

      if (action.ok) {
        return {
          ...state,
          status: 'completed',
          error: null,
          progress: null,
          completedBlob: null,
        };
      }

      return {
        ...state,
        status: 'failed',
        error: action.error || 'Transfer verification failed',
        progress: null,
      };
    }

    case 'COMPLETE_TRANSFER': {
      // Receiver completes from 'transferring'; Sender completes from 'awaiting_confirmation' (or directly if not waiting)
      const receiverCanComplete =
        state.direction === 'receiver' &&
        (state.status === 'transferring' || state.status === 'verifying');
      const senderCanComplete =
        state.direction === 'sender' && state.status === 'awaiting_confirmation';
      if (!receiverCanComplete && !senderCanComplete) {
        return state;
      }
      return {
        ...state,
        status: 'completed',
        error: null,
        progress: null,
        completedBlob: action.blob ?? null,
      };
    }

    case 'FAIL_TRANSFER': {
      if (state.status === 'completed' || state.status === 'cancelled' || state.status === 'failed') {
        return state;
      }
      return {
        ...state,
        status: 'failed',
        error: action.error,
      };
    }

    case 'CANCEL_TRANSFER': {
      if (
        state.status !== 'offered' &&
        state.status !== 'transferring' &&
        state.status !== 'verifying' &&
        state.status !== 'awaiting_confirmation'
      ) {
        return state;
      }
      return {
        ...state,
        status: 'cancelled',
        error: null,
        progress: null,
        completedBlob: null,
      };
    }

    case 'RESET_TRANSFER': {
      return initialTransferState;
    }

    default:
      return state;
  }
}

export function useTransferStateMachine() {
  const [state, dispatch] = useReducer(transferReducer, initialTransferState);

  const actions = useMemo(
    () => ({
      offerIncoming: (offer: FileOfferMsg) => dispatch({ type: 'OFFER_INCOMING', offer }),
      startSending: (offer: FileOfferMsg) => dispatch({ type: 'START_SENDING', offer }),
      acceptTransfer: () => dispatch({ type: 'ACCEPT_TRANSFER' }),
      updateProgress: (progress: TransferProgress) => dispatch({ type: 'UPDATE_PROGRESS', progress }),
      beginVerifying: () => dispatch({ type: 'BEGIN_VERIFYING' }),
      awaitConfirmation: () => dispatch({ type: 'AWAIT_CONFIRMATION' }),
      fileResult: (id: string, ok: boolean, error?: string) =>
        dispatch({ type: 'FILE_RESULT', id, ok, error }),
      completeTransfer: (blob?: Blob) => dispatch({ type: 'COMPLETE_TRANSFER', blob }),
      failTransfer: (error: string) => dispatch({ type: 'FAIL_TRANSFER', error }),
      cancelTransfer: () => dispatch({ type: 'CANCEL_TRANSFER' }),
      resetTransfer: () => dispatch({ type: 'RESET_TRANSFER' }),
    }),
    [],
  );

  return { state, actions, dispatch };
}
