import { describe, expect, it } from 'vitest';
import { GraphLayout, flatGraphRows, layoutGraph, type CommitInfo } from '@angkorgit/core';

const sig = { name: 'Test', email: 't@example.com', time: 0 };

function commit(oid: string, parents: string[]): CommitInfo {
  return {
    oid,
    shortOid: oid.slice(0, 8),
    summary: `commit ${oid}`,
    body: '',
    author: sig,
    committer: sig,
    parents,
    refs: [],
    isHead: false,
  };
}

describe('GraphLayout', () => {
  it('lays out a linear history on a single lane', () => {
    const { rows, maxLane } = layoutGraph([
      commit('c3', ['c2']),
      commit('c2', ['c1']),
      commit('c1', []),
    ]);
    expect(rows).toHaveLength(3);
    expect(maxLane).toBe(0);
    expect(rows.every((r) => r.node.lane === 0)).toBe(true);
    expect(rows[0].node.hasIncoming).toBe(false);
    expect(rows[0].node.continues).toBe(true);
    expect(rows[2].node.continues).toBe(false); // root
  });

  it('assigns a second lane to a parallel branch', () => {
    const { rows, maxLane } = layoutGraph([
      commit('m2', ['m1']),
      commit('f1', ['base']),
      commit('m1', ['base']),
      commit('base', []),
    ]);
    expect(maxLane).toBe(1);
    const f1 = rows.find((r) => r.node.oid === 'f1')!;
    expect(f1.node.lane).toBe(1);
    const base = rows.find((r) => r.node.oid === 'base')!;
    expect(base.node.closing).toHaveLength(1);
  });

  it('marks merge commits and opens merge lanes', () => {
    const { rows } = layoutGraph([
      commit('merge', ['m1', 'f1']),
      commit('m1', ['base']),
      commit('f1', ['base']),
      commit('base', []),
    ]);
    const merge = rows.find((r) => r.node.oid === 'merge')!;
    expect(merge.node.isMerge).toBe(true);
    expect(merge.node.merges).toHaveLength(1);
    expect(merge.node.merges[0].lane).not.toBe(merge.node.lane);
  });

  it('is stable under incremental feeding (pagination)', () => {
    const commits = [
      commit('m3', ['m2']),
      commit('m2', ['m1', 'f1']),
      commit('f1', ['m1']),
      commit('m1', ['m0']),
      commit('m0', []),
    ];
    const whole = layoutGraph(commits);
    const incremental = new GraphLayout();
    incremental.add(commits.slice(0, 2));
    const firstTwo = incremental.getRows().slice(0, 2).map((r) => JSON.stringify(r));
    incremental.add(commits.slice(2));

    expect(incremental.getRows().slice(0, 2).map((r) => JSON.stringify(r))).toEqual(firstTwo);
    expect(JSON.stringify(incremental.getRows())).toEqual(JSON.stringify(whole.rows));
  });

  it('reuses freed lanes to keep the graph narrow', () => {
    const { maxLane } = layoutGraph([
      commit('m4', ['m3', 'f2']),
      commit('f2', ['m3']),
      commit('m3', ['m2']),
      commit('m2', ['m1', 'f1']),
      commit('f1', ['m1']),
      commit('m1', []),
    ]);
    expect(maxLane).toBe(1);
  });

  it('explodes lanes when parents are filtered out (why filtered views need flatGraphRows)', () => {
    const disconnected = Array.from({ length: 20 }, (_, i) =>
      commit(`c${i}`, [`missing${i}`]),
    );
    const { maxLane } = layoutGraph(disconnected);
    expect(maxLane).toBe(19);
  });
});

describe('flatGraphRows', () => {
  it('keeps every commit on lane 0 with no connecting lines', () => {
    const disconnected = Array.from({ length: 20 }, (_, i) =>
      commit(`c${i}`, [`missing${i}`]),
    );
    const rows = flatGraphRows(disconnected);
    expect(rows).toHaveLength(20);
    expect(rows.every((r) => r.node.lane === 0 && r.node.color === 0)).toBe(true);
    expect(rows.every((r) => r.passing.length === 0 && r.node.merges.length === 0)).toBe(true);
    expect(rows.every((r) => !r.node.continues && !r.node.hasIncoming)).toBe(true);
  });

  it('numbers rows from startRow for pagination and keeps merge markers', () => {
    const page = [commit('m1', ['a', 'b']), commit('c1', ['a'])];
    const rows = flatGraphRows(page, 200);
    expect(rows[0].node.row).toBe(200);
    expect(rows[1].node.row).toBe(201);
    expect(rows[0].node.isMerge).toBe(true);
    expect(rows[1].node.isMerge).toBe(false);
  });
});
