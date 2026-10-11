import { useReducer, useMemo } from 'react';
import type { FileOfferMsg } from './protocol';
import type { TransferProgress } from './transfer';

export type TransferStateKind =
  | 'idle'
  | 'offered'
  | 'transferring'
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
 * - UPDATE_PROGRESS and COMPLETE_TRANSFER are only valid from 'transferring'
 * - CANCEL_TRANSFER is only valid from 'offered' or 'transferring'
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
      };
    }

    case 'UPDATE_PROGRESS': {
      if (state.status !== 'transferring') {
        return state;
      }
      return {
        ...state,
        progress: action.progress,
      };
    }

    case 'COMPLETE_TRANSFER': {
      if (state.status !== 'transferring') {
        return state;
      }
      return {
        ...state,
        status: 'completed',
        completedBlob: action.blob ?? null,
      };
    }

    case 'FAIL_TRANSFER': {
      if (state.status === 'completed' || state.status === 'cancelled') {
        return state;
      }
      return {
        ...state,
        status: 'failed',
        error: action.error,
      };
    }

    case 'CANCEL_TRANSFER': {
      if (state.status !== 'offered' && state.status !== 'transferring') {
        return state;
      }
      return {
        ...state,
        status: 'cancelled',
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
      completeTransfer: (blob?: Blob) => dispatch({ type: 'COMPLETE_TRANSFER', blob }),
      failTransfer: (error: string) => dispatch({ type: 'FAIL_TRANSFER', error }),
      cancelTransfer: () => dispatch({ type: 'CANCEL_TRANSFER' }),
      resetTransfer: () => dispatch({ type: 'RESET_TRANSFER' }),
    }),
    [],
  );

  return { state, actions, dispatch };
}
