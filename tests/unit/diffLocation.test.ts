import { describe, expect, it } from 'vitest';
import { columnAt, lineLocation, type DiffLine } from '@angkorgit/core';

const line = (kind: DiffLine['kind'], oldLineNo: number | null, newLineNo: number | null): DiffLine =>
  ({ kind, oldLineNo, newLineNo, content: 'const a = 1;' }) as DiffLine;

const file = { path: 'src/core/ipc.ts', oldPath: null };
const renamed = { path: 'src/core/ipc.ts', oldPath: 'src/ipc.ts' };

describe('lineLocation', () => {
  it('uses the new line number for additions and context lines', () => {
    expect(lineLocation(file, line('addition', null, 42))).toBe('src/core/ipc.ts:42');
    expect(lineLocation(file, line('context', 40, 41))).toBe('src/core/ipc.ts:41');
  });

  it('uses the old line number and old path for a deletion', () => {
    expect(lineLocation(renamed, line('deletion', 17, null))).toBe('src/ipc.ts:17');
  });

  it('follows the clicked pane in split view', () => {
    expect(lineLocation(renamed, line('context', 40, 41), 'old')).toBe('src/ipc.ts:40');
    expect(lineLocation(renamed, line('context', 40, 41), 'new')).toBe('src/core/ipc.ts:41');
  });

  it('adds the column when there is one', () => {
    expect(lineLocation(file, line('addition', null, 42), undefined, 7)).toBe('src/core/ipc.ts:42:7');
    expect(lineLocation(file, line('addition', null, 42), undefined, null)).toBe('src/core/ipc.ts:42');
  });

  it('has no location without a line number on that side', () => {
    expect(lineLocation(file, line('addition', null, 42), 'old')).toBeNull();
  });
});

describe('columnAt', () => {
  it('counts characters from one', () => {
    expect(columnAt('const a = 1;', 0)).toBe(1);
    expect(columnAt('const a = 1;', 6)).toBe(7);
  });

  it('has no column past the text or without a caret', () => {
    expect(columnAt('const', 5)).toBeNull();
    expect(columnAt('const', null)).toBeNull();
  });

  it('counts an emoji as one character', () => {
    expect(columnAt('😀x', 2)).toBe(2);
  });

  it('has no column inside the clipped part of a very long line', () => {
    expect(columnAt('x'.repeat(6000), 5500)).toBeNull();
    expect(columnAt('x'.repeat(6000), 4999)).toBe(5000);
  });
});
