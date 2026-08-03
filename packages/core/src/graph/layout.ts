import type { CommitInfo } from '../git/types';

/**
 * Incremental commit-graph lane layout.
 *
 * Commits arrive in topological/time order (as produced by the engine's
 * revwalk). Each commit is assigned a lane (column) and every row carries
 * exactly the geometry the renderer needs:
 *
 *  - `passing`  — lanes flowing straight through this row
 *  - `closing`  — lanes that curve into this row's node (branch tips merging)
 *  - `merges`   — lanes that curve out of a merge commit toward extra parents
 *  - `hasIncoming` / `continues` — whether the node's own lane connects
 *    upward and/or downward
 *
 * The algorithm is O(n · activeLanes) and incremental: feeding more pages
 * never changes already-computed rows, which keeps virtualized rendering
 * stable while history streams in.
 */

export interface LaneRef {
  lane: number;
  color: number;
}

export interface GraphNode {
  oid: string;
  row: number;
  lane: number;
  color: number;
  isMerge: boolean;
  /** a lane above is waiting for this commit */
  hasIncoming: boolean;
  /** the first parent continues below in the same lane */
  continues: boolean;
  /** lanes (beyond the first) that close into this node from above */
  closing: LaneRef[];
  /** lanes that open from this node toward extra parents (merge links) */
  merges: LaneRef[];
}

export interface GraphRow {
  node: GraphNode;
  /** lanes that pass straight through this row */
  passing: LaneRef[];
}

interface ActiveLane {
  /** oid this lane is waiting to meet */
  expects: string;
  color: number;
}

export class GraphLayout {
  private lanes: Array<ActiveLane | null> = [];
  private rows: GraphRow[] = [];
  private rowByOid = new Map<string, number>();
  private nextColor = 0;
  private colorByOid = new Map<string, number>();
  private _maxLane = 0;

  get rowCount(): number {
    return this.rows.length;
  }

  getRows(): readonly GraphRow[] {
    return this.rows;
  }

  rowOf(oid: string): number | undefined {
    return this.rowByOid.get(oid);
  }

  /** Maximum lane index used so far (for computing graph gutter width). */
  get maxLane(): number {
    return this._maxLane;
  }

  add(commits: readonly CommitInfo[]): void {
    for (const commit of commits) this.addOne(commit);
  }

  private allocColor(oid: string): number {
    const existing = this.colorByOid.get(oid);
    if (existing !== undefined) return existing;
    const color = this.nextColor++;
    this.colorByOid.set(oid, color);
    return color;
  }

  private addOne(commit: CommitInfo): void {
    const row = this.rows.length;
    this.rowByOid.set(commit.oid, row);

    // Lanes occupied before this commit lands (these drew rails from above).
    const before: Array<{ index: number; active: ActiveLane }> = [];
    for (let i = 0; i < this.lanes.length; i++) {
      const l = this.lanes[i];
      if (l) before.push({ index: i, active: l });
    }

    // Lanes waiting for exactly this commit.
    const waiting = before.filter((b) => b.active.expects === commit.oid);

    let lane: number;
    let color: number;

    if (waiting.length === 0) {
      lane = this.firstFreeLane();
      color = this.allocColor(commit.oid);
    } else {
      lane = waiting[0].index;
      color = waiting[0].active.color;
      for (const w of waiting) this.lanes[w.index] = null;
    }

    const closing: LaneRef[] = waiting
      .slice(1)
      .map((w) => ({ lane: w.index, color: w.active.color }));

    // Continue the node's lane toward the first parent.
    const [firstParent, ...restParents] = commit.parents;
    if (firstParent !== undefined) {
      this.lanes[lane] = { expects: firstParent, color };
    } else {
      this.lanes[lane] = null; // root commit
    }

    // Extra parents of a merge commit: reuse a lane already waiting for that
    // parent, or open a fresh lane.
    const merges: LaneRef[] = [];
    for (const parent of restParents) {
      const existing = this.lanes.findIndex((l) => l?.expects === parent);
      if (existing >= 0) {
        merges.push({ lane: existing, color: this.lanes[existing]!.color });
      } else {
        const newLane = this.firstFreeLane();
        const newColor = this.allocColor(parent);
        this.lanes[newLane] = { expects: parent, color: newColor };
        merges.push({ lane: newLane, color: newColor });
      }
    }

    // Straight rails: active before, not closing into the node, not the node.
    const waitingSet = new Set(waiting.map((w) => w.index));
    const passing: LaneRef[] = before
      .filter((b) => !waitingSet.has(b.index) && b.index !== lane)
      .map((b) => ({ lane: b.index, color: b.active.color }));

    for (const p of passing) this._maxLane = Math.max(this._maxLane, p.lane);
    for (const m of merges) this._maxLane = Math.max(this._maxLane, m.lane);
    for (const c of closing) this._maxLane = Math.max(this._maxLane, c.lane);
    this._maxLane = Math.max(this._maxLane, lane);

    this.rows.push({
      node: {
        oid: commit.oid,
        row,
        lane,
        color,
        isMerge: commit.parents.length > 1,
        hasIncoming: waiting.length > 0,
        continues: firstParent !== undefined,
        closing,
        merges,
      },
      passing,
    });
  }

  private firstFreeLane(): number {
    const idx = this.lanes.findIndex((l) => l === null);
    if (idx >= 0) return idx;
    this.lanes.push(null);
    return this.lanes.length - 1;
  }
}

/** Convenience: lay out a full list at once. */
export function layoutGraph(commits: readonly CommitInfo[]): {
  rows: readonly GraphRow[];
  maxLane: number;
} {
  const layout = new GraphLayout();
  layout.add(commits);
  return { rows: layout.getRows(), maxLane: layout.maxLane };
}
