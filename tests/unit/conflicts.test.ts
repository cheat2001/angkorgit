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

  it('treats content lines of 8+ marker characters as content, not markers', () => {
    const input = `<<<<<<< HEAD
title
========
ours body
=======
theirs
>>>>>>> other`;
    const blocks = parseConflicts(input);
    const conflict = blocks.find((b) => b.kind === 'conflict') as ConflictBlock;
    expect(conflict.current).toEqual(['title', '========', 'ours body']);
    expect(conflict.incoming).toEqual(['theirs']);
    expect(serializeResolution(blocks)).toBe(input);
  });

  it('round-trips diff3 base labels losslessly', () => {
    const diff3 = `<<<<<<< HEAD
ours
||||||| merged common ancestors
original
=======
theirs
>>>>>>> other`;
    const blocks = parseConflicts(diff3);
    expect(serializeResolution(blocks)).toBe(diff3);
  });

  it('round-trips CRLF content without changing line endings', () => {
    const crlf = 'a\r\n<<<<<<< HEAD\r\nours\r\n=======\r\ntheirs\r\n>>>>>>> feat\r\nb\r\n';
    const blocks = parseConflicts(crlf);
    expect(conflictCount(blocks)).toBe(1);
    expect(serializeResolution(blocks)).toBe(crlf);
  });

  it('round-trips bare markers without adding trailing spaces', () => {
    const bare = '<<<<<<<\nours\n=======\ntheirs\n>>>>>>>';
    const blocks = parseConflicts(bare);
    expect(conflictCount(blocks)).toBe(1);
    expect(serializeResolution(blocks)).toBe(bare);
  });

  it('treats a close marker without a separator as plain text', () => {
    const invalid = 'a\n<<<<<<< HEAD\nours\n>>>>>>> other\nb';
    const blocks = parseConflicts(invalid);
    expect(conflictCount(blocks)).toBe(0);
    expect(serializeResolution(blocks)).toBe(invalid);
  });
});
