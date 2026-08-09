import type { CommitInfo } from '../git/types';

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
  hasIncoming: boolean;
  continues: boolean;
  closing: LaneRef[];
  merges: LaneRef[];
}

export interface GraphRow {
  node: GraphNode;
  passing: LaneRef[];
}

interface ActiveLane {
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

    const before: Array<{ index: number; active: ActiveLane }> = [];
    for (let i = 0; i < this.lanes.length; i++) {
      const l = this.lanes[i];
      if (l) before.push({ index: i, active: l });
    }

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

    const [firstParent, ...restParents] = commit.parents;
    if (firstParent !== undefined) {
      this.lanes[lane] = { expects: firstParent, color };
    } else {
      this.lanes[lane] = null; // root commit
    }

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

export function flatGraphRows(commits: readonly CommitInfo[], startRow = 0): GraphRow[] {
  return commits.map((commit, i) => ({
    node: {
      oid: commit.oid,
      row: startRow + i,
      lane: 0,
      color: 0,
      isMerge: commit.parents.length > 1,
      hasIncoming: false,
      continues: false,
      closing: [],
      merges: [],
    },
    passing: [],
  }));
}

export function layoutGraph(commits: readonly CommitInfo[]): {
  rows: readonly GraphRow[];
  maxLane: number;
} {
  const layout = new GraphLayout();
  layout.add(commits);
  return { rows: layout.getRows(), maxLane: layout.maxLane };
}
