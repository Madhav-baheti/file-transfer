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
  | { type: 'ADD_MESSAGE'; message: Omit<ChatMessage, 'id' | 'timestamp'> }
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

    case 'PEER_FOUND':
      return {
        ...state,
        status: 'connecting',
        error: null,
      };

    case 'CONNECTED':
      return {
        ...state,
        status: 'connected',
        error: null,
      };

    case 'ADD_MESSAGE': {
      const newMessage: ChatMessage = {
        id: Math.random().toString(36).substring(2, 9),
        sender: action.message.sender,
        text: action.message.text,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      return {
        ...state,
        messages: [...state.messages, newMessage],
      };
    }

    case 'FAIL':
      return {
        ...state,
        status: 'failed',
        error: action.error,
      };

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
      addMessage: (sender: 'self' | 'peer', text: string) =>
        dispatch({ type: 'ADD_MESSAGE', message: { sender, text } }),
      fail: (error: string) => dispatch({ type: 'FAIL', error }),
      close: () => dispatch({ type: 'CLOSE' }),
      reset: () => dispatch({ type: 'RESET' }),
    }),
    [],
  );

  return { state, actions, dispatch };
}
