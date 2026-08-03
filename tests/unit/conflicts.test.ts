import { describe, expect, it } from 'vitest';
import {
  allResolved,
  conflictCount,
  parseConflicts,
  serializeResolution,
  type ConflictBlock,
} from '@angkorgit/core';

const SAMPLE = `line 1
<<<<<<< HEAD
ours line
=======
theirs line
>>>>>>> feature/x
line 2`;

describe('conflict parsing', () => {
  it('parses a single conflict with surrounding text', () => {
    const blocks = parseConflicts(SAMPLE);
    expect(conflictCount(blocks)).toBe(1);
    const conflict = blocks.find((b) => b.kind === 'conflict') as ConflictBlock;
    expect(conflict.current).toEqual(['ours line']);
    expect(conflict.incoming).toEqual(['theirs line']);
    expect(conflict.currentLabel).toBe('HEAD');
    expect(conflict.incomingLabel).toBe('feature/x');
  });

  it('parses diff3-style base sections', () => {
    const diff3 = `<<<<<<< HEAD
ours
||||||| base
original
=======
theirs
>>>>>>> other`;
    const blocks = parseConflicts(diff3);
    const conflict = blocks.find((b) => b.kind === 'conflict') as ConflictBlock;
    expect(conflict.base).toEqual(['original']);
  });

  it('serializes each resolution mode correctly', () => {
    const blocks = parseConflicts(SAMPLE);
    const idx = blocks.findIndex((b) => b.kind === 'conflict');

    (blocks[idx] as ConflictBlock).resolution = 'current';
    expect(serializeResolution(blocks)).toBe('line 1\nours line\nline 2');

    (blocks[idx] as ConflictBlock).resolution = 'incoming';
    expect(serializeResolution(blocks)).toBe('line 1\ntheirs line\nline 2');

    (blocks[idx] as ConflictBlock).resolution = 'both';
    expect(serializeResolution(blocks)).toBe('line 1\nours line\ntheirs line\nline 2');
  });

  it('re-emits markers for unresolved conflicts (lossless)', () => {
    const blocks = parseConflicts(SAMPLE);
    expect(allResolved(blocks)).toBe(false);
    expect(serializeResolution(blocks)).toBe(SAMPLE);
  });

  it('keeps malformed markers as plain text', () => {
    const malformed = 'a\n<<<<<<< HEAD\nno closing marker\n';
    const blocks = parseConflicts(malformed);
    expect(conflictCount(blocks)).toBe(0);
    expect(serializeResolution(blocks)).toBe(malformed);
  });
});
