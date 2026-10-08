import type { DiffHunk, DiffLine } from '../git/types';

export interface LinePair {
  left: DiffLine | null;
  right: DiffLine | null;
}

interface AlignedPair {
  a: number | null;
  b: number | null;
}

function tokenizeLine(line: string): string[] {
  return line.match(/\w+|\s+|[^\w\s]/g) ?? [];
}

const MAX_LINE_DISTANCE = 0.4;

const ALIGN_GAP_MAX_PAIRS = 4_096;

const PAIR_SIDES_MAX_CELLS = 250_000;

function lcsSteps(a: string[], b: string[]): AlignedPair[] {
  const m = a.length;
  const n = b.length;
  const dp: Uint32Array = new Uint32Array((m + 1) * (n + 1));
  const at = (i: number, j: number) => dp[i * (n + 1) + j];

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i * (n + 1) + j] =
        a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }

  const steps: AlignedPair[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) steps.push({ a: i++, b: j++ });
    else if (at(i + 1, j) >= at(i, j + 1)) steps.push({ a: i++, b: null });
    else steps.push({ a: null, b: j++ });
  }
  while (i < m) steps.push({ a: i++, b: null });
  while (j < n) steps.push({ a: null, b: j++ });
  return steps;
}

function tokenDistance(a: readonly string[], b: readonly string[]): number {
  const total = a.length + b.length;
  if (total === 0) return 0;
  const counts = new Map<string, number>();
  for (const token of a) counts.set(token, (counts.get(token) ?? 0) + 1);
  let shared = 0;
  for (const token of b) {
    const n = counts.get(token) ?? 0;
    if (n === 0) continue;
    shared += 1;
    counts.set(token, n - 1);
  }
  return 1 - (2 * shared) / total;
}

function alignGap(
  linesA: readonly string[],
  idxA: number[],
  linesB: readonly string[],
  idxB: number[],
): AlignedPair[] {
  if (idxA.length === 1 && idxB.length === 1) return [{ a: idxA[0], b: idxB[0] }];
  if (idxA.length * idxB.length > ALIGN_GAP_MAX_PAIRS) {
    const out: AlignedPair[] = [];
    const n = Math.max(idxA.length, idxB.length);
    for (let i = 0; i < n; i++) out.push({ a: idxA[i] ?? null, b: idxB[i] ?? null });
    return out;
  }
  const tokA = idxA.map((i) => tokenizeLine(linesA[i]));
  const tokB = idxB.map((i) => tokenizeLine(linesB[i]));
  const out: AlignedPair[] = [];
  let j = 0;
  for (let i = 0; i < idxA.length; i++) {
    let match = -1;
    for (let k = j; k < idxB.length; k++) {
      if (tokenDistance(tokA[i], tokB[k]) <= MAX_LINE_DISTANCE) {
        match = k;
        break;
      }
    }
    if (match < 0) {
      out.push({ a: idxA[i], b: null });
      continue;
    }
    for (let k = j; k < match; k++) out.push({ a: null, b: idxB[k] });
    out.push({ a: idxA[i], b: idxB[match] });
    j = match + 1;
  }
  for (; j < idxB.length; j++) out.push({ a: null, b: idxB[j] });
  return out;
}

function pairSides(a: string[], b: string[]): AlignedPair[] {
  if (a.length * b.length > PAIR_SIDES_MAX_CELLS) {
    const out: AlignedPair[] = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      out.push({ a: i < a.length ? i : null, b: i < b.length ? i : null });
    }
    return out;
  }

  const out: AlignedPair[] = [];
  let onlyA: number[] = [];
  let onlyB: number[] = [];
  const flush = () => {
    out.push(...alignGap(a, onlyA, b, onlyB));
    onlyA = [];
    onlyB = [];
  };

  for (const step of lcsSteps(a, b)) {
    if (step.a !== null && step.b !== null) {
      flush();
      out.push(step);
    } else if (step.a !== null) onlyA.push(step.a);
    else onlyB.push(step.b as number);
  }
  flush();
  return out;
}

export function pairHunkLines(hunk: DiffHunk): LinePair[] {
  const pairs: LinePair[] = [];
  let removed: DiffLine[] = [];
  let added: DiffLine[] = [];

  const flush = () => {
    for (const step of pairSides(
      removed.map((line) => line.content),
      added.map((line) => line.content),
    )) {
      pairs.push({
        left: step.a === null ? null : removed[step.a],
        right: step.b === null ? null : added[step.b],
      });
    }
    removed = [];
    added = [];
  };

  for (const line of hunk.lines) {
    if (line.kind === 'deletion') removed.push(line);
    else if (line.kind === 'addition') added.push(line);
    else {
      flush();
      pairs.push({ left: line, right: line });
    }
  }
  flush();
  return pairs;
}
