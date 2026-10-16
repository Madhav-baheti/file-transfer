import { describe, expect, it } from 'vitest';
import {
  fileQueueReducer,
  nextQueuedFile,
  type FileQueueEntry,
} from '../src/lib/fileQueue';

function entry(id: string, status: FileQueueEntry['status'] = 'queued'): FileQueueEntry {
  const file = new File(['data'], `${id}.txt`);
  return {
    id,
    file,
    name: file.name,
    size: file.size,
    status,
    progress: null,
    error: null,
  };
}

describe('file queue reducer', () => {
  it('preserves enqueue order and picks the first queued item', () => {
    const queue = fileQueueReducer([], {
      type: 'ENQUEUE',
      entries: [entry('first'), entry('second'), entry('third')],
    });
    expect(queue.map((item) => item.id)).toEqual(['first', 'second', 'third']);
    expect(nextQueuedFile(queue)?.id).toBe('first');
  });

  it('keeps one file failure or decline isolated from later queue items', () => {
    const queued = [entry('first', 'awaiting-acceptance'), entry('second')];
    const declined = fileQueueReducer(queued, {
      type: 'SET_STATUS',
      id: 'first',
      status: 'declined',
    });
    expect(declined[0].status).toBe('declined');
    expect(nextQueuedFile(declined)?.id).toBe('second');

    const failed = fileQueueReducer(declined, {
      type: 'SET_STATUS',
      id: 'second',
      status: 'failed',
      error: 'Transfer failed',
    });
    expect(failed[1].error).toBe('Transfer failed');
  });

  it('ignores stale transitions and updates progress only for the transferring file', () => {
    const initial = [entry('first', 'complete'), entry('second', 'transferring')];
    const stale = fileQueueReducer(initial, {
      type: 'SET_STATUS',
      id: 'first',
      status: 'complete',
    });
    expect(stale).toBe(initial);

    const progress = {
      fileId: 'second',
      filename: 'second.txt',
      totalBytes: 4,
      transferredBytes: 2,
      percentage: 50,
      speedBytesPerSec: 1,
      etaSeconds: 2,
    };
    const updated = fileQueueReducer(initial, {
      type: 'UPDATE_PROGRESS',
      id: 'second',
      progress,
    });
    expect(updated[1].progress).toEqual(progress);
    expect(updated[0].progress).toBeNull();
  });

  it('requires confirmation before completion and isolates cancellation to the requested file', () => {
    const initial = [entry('first', 'transferring'), entry('second')];
    const prematureCompletion = fileQueueReducer(initial, {
      type: 'SET_STATUS',
      id: 'first',
      status: 'complete',
    });
    expect(prematureCompletion).toBe(initial);

    const confirmed = fileQueueReducer(initial, {
      type: 'SET_STATUS',
      id: 'first',
      status: 'awaiting-confirmation',
    });
    const completed = fileQueueReducer(confirmed, {
      type: 'SET_STATUS',
      id: 'first',
      status: 'complete',
    });
    expect(completed[0].status).toBe('complete');

    const cancelled = fileQueueReducer(completed, {
      type: 'CANCEL_QUEUED',
      id: 'second',
    });
    expect(cancelled[0].status).toBe('complete');
    expect(cancelled[1].status).toBe('cancelled');
  });
});
