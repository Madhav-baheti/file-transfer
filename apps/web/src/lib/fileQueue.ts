import type { TransferProgress } from './transfer';
import { sanitizeFilename } from './transfer';

export type FileQueueStatus =
  | 'queued'
  | 'awaiting-acceptance'
  | 'transferring'
  | 'awaiting-confirmation'
  | 'complete'
  | 'declined'
  | 'cancelled'
  | 'failed';

export interface FileQueueEntry {
  id: string;
  file: File;
  name: string;
  size: number;
  status: FileQueueStatus;
  progress: TransferProgress | null;
  error: string | null;
}

export type FileQueueAction =
  | { type: 'ENQUEUE'; entries: FileQueueEntry[] }
  | { type: 'SET_STATUS'; id: string; status: FileQueueStatus; error?: string | null }
  | { type: 'UPDATE_PROGRESS'; id: string; progress: TransferProgress }
  | { type: 'CANCEL_QUEUED'; id: string }
  | { type: 'CLEAR' };

export const initialFileQueue: FileQueueEntry[] = [];

export function createFileQueueEntries(files: File[]): FileQueueEntry[] {
  return files.map((file) => ({
    id: crypto.randomUUID().replace(/-/g, '').slice(0, 16),
    file,
    name: sanitizeFilename(file.name),
    size: file.size,
    status: 'queued',
    progress: null,
    error: null,
  }));
}

const allowedTransitions: Record<FileQueueStatus, FileQueueStatus[]> = {
  queued: ['awaiting-acceptance', 'cancelled', 'failed'],
  'awaiting-acceptance': ['transferring', 'declined', 'cancelled', 'failed'],
  transferring: ['awaiting-confirmation', 'declined', 'cancelled', 'failed'],
  'awaiting-confirmation': ['complete', 'failed', 'cancelled'],
  complete: [],
  declined: [],
  cancelled: [],
  failed: [],
};

export function fileQueueReducer(
  state: FileQueueEntry[],
  action: FileQueueAction,
): FileQueueEntry[] {
  switch (action.type) {
    case 'ENQUEUE':
      return [...state, ...action.entries];
    case 'SET_STATUS': {
      let statusChanged = false;
      const statusUpdated = state.map((entry) => {
        if (
          entry.id !== action.id ||
          !allowedTransitions[entry.status].includes(action.status)
        ) {
          return entry;
        }
        statusChanged = true;
        return {
          ...entry,
          status: action.status,
          error: action.error ?? null,
        };
      });
      return statusChanged ? statusUpdated : state;
    }
    case 'UPDATE_PROGRESS':
      if (!state.some((entry) => entry.id === action.id && entry.status === 'transferring')) {
        return state;
      }
      return state.map((entry) =>
        entry.id === action.id && entry.status === 'transferring'
          ? { ...entry, progress: action.progress }
          : entry,
      );
    case 'CANCEL_QUEUED':
      if (!state.some((entry) => entry.id === action.id && entry.status === 'queued')) {
        return state;
      }
      return state.map((entry) =>
        entry.id === action.id && entry.status === 'queued'
          ? { ...entry, status: 'cancelled' }
          : entry,
      );
    case 'CLEAR':
      return initialFileQueue;
  }
}

export function nextQueuedFile(entries: FileQueueEntry[]): FileQueueEntry | null {
  return entries.find((entry) => entry.status === 'queued') ?? null;
}
