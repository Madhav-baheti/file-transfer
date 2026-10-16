import { describe, expect, it } from 'vitest';
import {
  extractSharedFiles,
  parseShareTargetMessage,
} from '../src/lib/shareTarget';

describe('web share target input', () => {
  it('extracts files from a multipart share request in order', () => {
    const first = new File(['one'], 'one.txt');
    const second = new File(['two'], 'two.txt');
    const data = new FormData();
    data.append('files', first);
    data.append('files', second);
    data.append('title', 'ignored title');

    expect(extractSharedFiles(data)).toEqual([first, second]);
  });

  it('returns no files for empty or malformed share requests', () => {
    const empty = new FormData();
    const malformed = new FormData();
    malformed.append('files', 'not a file');
    expect(extractSharedFiles(empty)).toEqual([]);
    expect(extractSharedFiles(malformed)).toEqual([]);
  });

  it('accepts only valid worker handoff messages', () => {
    const file = new File(['data'], 'shared.txt');
    expect(parseShareTargetMessage({ type: 'quickdrop-share-target', id: '1', files: [file] }))
      .toEqual({ type: 'quickdrop-share-target', id: '1', files: [file] });
    expect(parseShareTargetMessage({ type: 'quickdrop-share-target', id: '1', files: ['bad'] }))
      .toBeNull();
    expect(parseShareTargetMessage(null)).toBeNull();
    expect(parseShareTargetMessage({ type: 'quickdrop-share-target-error', id: '2', error: 'Empty share' }))
      .toEqual({
        type: 'quickdrop-share-target-error',
        id: '2',
        error: 'Empty share',
      });
  });
});
