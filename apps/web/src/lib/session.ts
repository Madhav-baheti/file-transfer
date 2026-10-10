import { useReducer, useMemo } from 'react';

export type SessionStateKind =
  | 'idle'
  | 'waiting'
  | 'connecting'
  | 'connected'
  | 'failed'
  | 'closed';

export interface ChatMessage {
  id: string;
  sender: 'self' | 'peer';
  text: string;
  timestamp: string;
}

export interface SessionState {
  status: SessionStateKind;
  role: 'initiator' | 'responder' | null;
  code: string | null;
  error: string | null;
  messages: ChatMessage[];
}

export type SessionAction =
  | { type: 'START_CREATE' }
  | { type: 'CREATED'; code: string }
  | { type: 'PROMPT_JOIN' }
  | { type: 'START_JOIN'; code: string }
  | { type: 'PEER_FOUND' }
  | { type: 'CONNECTED' }
  | { type: 'ADD_MESSAGE'; message: ChatMessage }
  | { type: 'FAIL'; error: string }
  | { type: 'CLOSE' }
  | { type: 'RESET' };

export const initialSessionState: SessionState = {
  status: 'idle',
  role: null,
  code: null,
  error: null,
  messages: [],
};

/**
 * Pure reducer for the session pairing & transfer state machine.
 * Transition guards:
 * - CONNECTED is only valid from 'connecting' (ignored otherwise).
 * - PEER_FOUND, CONNECTED, and FAIL are ignored once status is 'closed'.
 * - CONNECTED is ignored once status is 'failed'.
 */
export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'START_CREATE':
      return {
        ...state,
        status: 'waiting',
        role: 'initiator',
        code: null,
        error: null,
        messages: [],
      };

    case 'CREATED':
      return {
        ...state,
        status: 'waiting',
        code: action.code,
        error: null,
      };

    case 'PROMPT_JOIN':
      return {
        ...state,
        status: 'connecting',
        role: 'responder',
        code: null,
        error: null,
        messages: [],
      };

    case 'START_JOIN':
      return {
        ...state,
        status: 'connecting',
        role: 'responder',
        code: action.code,
        error: null,
        messages: [],
      };

    case 'PEER_FOUND': {
      // Ignore if session has already closed or failed
      if (state.status === 'closed' || state.status === 'failed') {
        return state;
      }
      return {
        ...state,
        status: 'connecting',
        error: null,
      };
    }

    case 'CONNECTED': {
      // Guard: CONNECTED is only allowed when currently in 'connecting'
      // Ignore if closed, failed, waiting, or already connected
      if (state.status !== 'connecting') {
        return state;
      }
      return {
        ...state,
        status: 'connected',
        error: null,
      };
    }

    case 'ADD_MESSAGE': {
      return {
        ...state,
        messages: [...state.messages, action.message],
      };
    }

    case 'FAIL': {
      // Ignore failure events if the session was already closed
      if (state.status === 'closed') {
        return state;
      }
      return {
        ...state,
        status: 'failed',
        error: action.error,
      };
    }

    case 'CLOSE':
      return {
        ...state,
        status: 'closed',
      };

    case 'RESET':
      return initialSessionState;

    default:
      return state;
  }
}

/**
 * Custom React hook wrapping the pairing state machine via useReducer.
 */
export function useSessionStateMachine() {
  const [state, dispatch] = useReducer(sessionReducer, initialSessionState);

  const actions = useMemo(
    () => ({
      startCreate: () => dispatch({ type: 'START_CREATE' }),
      created: (code: string) => dispatch({ type: 'CREATED', code }),
      promptJoin: () => dispatch({ type: 'PROMPT_JOIN' }),
      startJoin: (code: string) => dispatch({ type: 'START_JOIN', code }),
      peerFound: () => dispatch({ type: 'PEER_FOUND' }),
      connected: () => dispatch({ type: 'CONNECTED' }),
      addMessage: (sender: 'self' | 'peer', text: string) => {
        // ID and timestamp generation moved out of reducer so reducer remains pure
        const message: ChatMessage = {
          id: Math.random().toString(36).substring(2, 9),
          sender,
          text: text.slice(0, 4000),
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        dispatch({ type: 'ADD_MESSAGE', message });
      },
      fail: (error: string) => dispatch({ type: 'FAIL', error }),
      close: () => dispatch({ type: 'CLOSE' }),
      reset: () => dispatch({ type: 'RESET' }),
    }),
    [],
  );

  return { state, actions, dispatch };
}
