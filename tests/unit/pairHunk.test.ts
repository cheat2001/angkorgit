import { describe, expect, it } from 'vitest';
import { pairHunkLines, type DiffHunk, type DiffLine } from '@angkorgit/core';
import { demoFileDiff } from '../../apps/desktop/src/core/demo';

const del = (n: number, content: string): DiffLine => ({
  kind: 'deletion',
  oldLineNo: n,
  newLineNo: null,
  content,
});
const add = (n: number, content: string): DiffLine => ({
  kind: 'addition',
  oldLineNo: null,
  newLineNo: n,
  content,
});

function hunk(lines: DiffLine[]): DiffHunk {
  return { header: '@@ -1 +1 @@', oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines };
}

function sides(lines: DiffLine[]) {
  return pairHunkLines(hunk(lines)).map((pair) => [
    pair.left?.content ?? null,
    pair.right?.content ?? null,
  ]);
}

describe('pairHunkLines', () => {
  it('pairs a similar line across an unrelated insertion', () => {
    expect(
      sides([
        del(1, 'function load(id) {'),
        del(2, '  return db.get(id);'),
        add(1, 'function load(userId) {'),
        add(2, '  logger.info(userId);'),
        add(3, '  return db.get(userId);'),
      ]),
    ).toEqual([
      ['function load(id) {', 'function load(userId) {'],
      [null, '  logger.info(userId);'],
      ['  return db.get(id);', '  return db.get(userId);'],
    ]);
  });

  it('leaves unrelated replacements unpaired', () => {
    expect(
      sides([
        del(1, 'alpha'),
        del(2, 'beta'),
        add(1, 'one'),
        add(2, 'two'),
        add(3, 'three'),
      ]),
    ).toEqual([
      ['alpha', null],
      ['beta', null],
      [null, 'one'],
      [null, 'two'],
      [null, 'three'],
    ]);
  });

  it('keeps a single-line edit as one row', () => {
    expect(sides([del(1, 'foo'), add(1, 'fooBar')])).toEqual([['foo', 'fooBar']]);
  });

  it('anchors identical lines so an insertion is not paired with them', () => {
    expect(
      sides([
        del(1, 'const count = items.length;'),
        del(2, 'return count;'),
        add(1, 'const count = items.length;'),
        add(2, 'const extra = true;'),
        add(3, 'return count;'),
      ]),
    ).toEqual([
      ['const count = items.length;', 'const count = items.length;'],
      [null, 'const extra = true;'],
      ['return count;', 'return count;'],
    ]);
  });

  it('pairs the shifted load lines in the CommitGraph demo', () => {
    const block = demoFileDiff.hunks.find((item) =>
      item.lines.some((line) => line.content.includes('logger.info')),
    );
    if (!block) throw new Error('demo diff is missing the load hunk');
    expect(
      pairHunkLines(block).map((pair) => [
        pair.left?.content ?? null,
        pair.right?.content ?? null,
      ]),
    ).toEqual([
      ['// cache', '// cache'],
      ['function load(id) {', 'function load(userId) {'],
      [null, '  logger.info(userId);'],
      ['  return db.get(id);', '  return db.get(userId);'],
      ['}', '}'],
    ]);
  });
});
