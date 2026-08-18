import type {
  BranchInfo,
  CliAgentInfo,
  CliRunResult,
  CommitInfo,
  FileDiff,
  HistoryPage,
  HistoryQuery,
  RecentRepository,
  RepositoryInfo,
  StashInfo,
  StatusSummary,
  TagInfo,
} from '@angkorgit/core';

const AUTHORS = [
  { name: 'Sokha Chan', email: 'sokha@angkorgit.dev' },
  { name: 'Dara Kim', email: 'dara@angkorgit.dev' },
  { name: 'Maly Sok', email: 'maly@angkorgit.dev' },
];

const SUBJECTS = [
  'feat(graph): virtualize commit rows',
  'fix(diff): handle renamed files in word diff',
  'refactor(core): extract lane allocator',
  'perf(history): lazy-load decorations',
  'feat(stash): quick apply from sidebar',
  'fix(remote): retry ssh agent auth once',
  'docs: update architecture overview',
  'test(conflicts): cover diff3 markers',
  'style(inspector): tighten spacing rhythm',
  'feat(ai): provider registry + adapters',
];

function makeCommits(count: number): CommitInfo[] {
  const commits: CommitInfo[] = [];
  const now = 1754200000;
  for (let i = 0; i < count; i++) {
    const oid = `${(count - i).toString(16).padStart(6, '0')}${'a'.repeat(34)}`;
    const author = AUTHORS[i % AUTHORS.length];
    const isMerge = i % 9 === 4 && i + 8 < count;
    const parents = [
      `${(count - i - 1).toString(16).padStart(6, '0')}${'a'.repeat(34)}`,
    ];
    if (isMerge) {
      parents.push(`${(count - i - 3).toString(16).padStart(6, '0')}${'a'.repeat(34)}`);
    }
    commits.push({
      oid,
      shortOid: oid.slice(0, 8),
      summary: isMerge
        ? `Merge branch 'feature/lane-${i % 5}'`
        : SUBJECTS[i % SUBJECTS.length],
      body: i % 6 === 0 ? 'Detailed explanation of the change,\nwrapped at 72 columns.' : '',
      author: { ...author, time: now - i * 5400 },
      committer: { ...author, time: now - i * 5400 },
      parents: i === count - 1 ? [] : parents,
      refs:
        i === 0
          ? [
              { kind: 'localBranch', name: 'refs/heads/main', shorthand: 'main' },
              { kind: 'remoteBranch', name: 'refs/remotes/origin/main', shorthand: 'origin/main' },
            ]
          : i === 2
            ? [{ kind: 'tag', name: 'refs/tags/v0.4.0', shorthand: 'v0.4.0' }]
            : i === 7
              ? [{ kind: 'localBranch', name: 'refs/heads/feature/diff-viewer', shorthand: 'feature/diff-viewer' }]
              : [],
      isHead: i === 0,
    });
  }
  return commits;
}

const ALL_COMMITS = makeCommits(400);

export const demoRepo: RepositoryInfo = {
  path: '/Users/demo/projects/angkorgit',
  name: 'angkorgit (demo)',
  headBranch: 'main',
  headOid: ALL_COMMITS[0].oid,
  isDetached: false,
  isBare: false,
  state: 'clean',
};

export const demoRecents: RecentRepository[] = [
  { path: '/Users/demo/projects/angkorgit', name: 'angkorgit', lastOpenedAt: 1754200000 },
  { path: '/Users/demo/projects/temple-ui', name: 'temple-ui', lastOpenedAt: 1754100000 },
  { path: '/Users/demo/work/api-gateway', name: 'api-gateway', lastOpenedAt: 1753900000 },
];

export function demoHistory(query: HistoryQuery): HistoryPage {
  let commits = ALL_COMMITS;
  if (query.search) {
    const q = query.search.toLowerCase();
    commits = commits.filter(
      (c) => c.summary.toLowerCase().includes(q) || c.oid.startsWith(q),
    );
  }
  if (query.author) {
    const q = query.author.toLowerCase();
    commits = commits.filter((c) => c.author.name.toLowerCase().includes(q));
  }
  const page = commits.slice(query.skip, query.skip + query.limit);
  return { commits: page, hasMore: query.skip + query.limit < commits.length, total: commits.length };
}

export const demoStatus: StatusSummary = {
  files: [
    { path: 'src/features/graph/CommitGraph.tsx', origPath: null, staged: 'modified', unstaged: null },
    { path: 'src/core/ipc.ts', origPath: null, staged: null, unstaged: 'modified' },
    { path: 'src/data/palette-seed.sql', origPath: null, staged: null, unstaged: 'modified' },
    { path: 'docs/Architecture.md', origPath: null, staged: null, unstaged: 'untracked' },
    { path: 'src/old-layout.tsx', origPath: null, staged: 'deleted', unstaged: null },
  ],
  branch: 'main',
  ahead: 2,
  behind: 0,
};

export const demoBranches: BranchInfo[] = [
  { name: 'main', isHead: true, isRemote: false, upstream: 'origin/main', ahead: 2, behind: 0, targetOid: ALL_COMMITS[0].oid },
  { name: 'feature/diff-viewer', isHead: false, isRemote: false, upstream: null, ahead: 0, behind: 0, targetOid: ALL_COMMITS[7].oid },
  { name: 'fix/stash-race', isHead: false, isRemote: false, upstream: null, ahead: 0, behind: 0, targetOid: ALL_COMMITS[12].oid },
  { name: 'origin/main', isHead: false, isRemote: true, upstream: null, ahead: 0, behind: 0, targetOid: ALL_COMMITS[2].oid },
];

export const demoTags: TagInfo[] = [
  { name: 'v0.4.0', targetOid: ALL_COMMITS[2].oid, message: 'Release 0.4.0', isAnnotated: true },
  { name: 'v0.3.0', targetOid: ALL_COMMITS[40].oid, message: null, isAnnotated: false },
];

export const demoStashes: StashInfo[] = [
  { index: 0, message: 'WIP on main: experiment with lane colors', oid: ALL_COMMITS[5].oid },
];

export const demoFileDiff: FileDiff = {
  path: 'src/features/graph/CommitGraph.tsx',
  oldPath: null,
  status: 'modified',
  isBinary: false,
  isImage: false,
  oldImage: null,
  newImage: null,
  additions: 16,
  deletions: 8,
  hunks: [
    {
      header: '@@ -1,8 +1,9 @@',
      oldStart: 1,
      oldLines: 8,
      newStart: 1,
      newLines: 9,
      lines: [
        { kind: 'context', oldLineNo: 1, newLineNo: 1, content: "import { memo } from 'react';" },
        { kind: 'deletion', oldLineNo: 2, newLineNo: null, content: "import { ROW_HEIGHT } from './constants';" },
        { kind: 'addition', oldLineNo: null, newLineNo: 2, content: "import { useVirtualizer } from '@tanstack/react-virtual';" },
        { kind: 'addition', oldLineNo: null, newLineNo: 3, content: "import { ROW_HEIGHT, OVERSCAN } from './constants';" },
        { kind: 'context', oldLineNo: 3, newLineNo: 4, content: "import { useGraphRows } from './store';" },
        { kind: 'context', oldLineNo: 4, newLineNo: 5, content: "import { GraphRow } from './GraphRow';" },
        { kind: 'context', oldLineNo: 5, newLineNo: 6, content: '' },
        { kind: 'deletion', oldLineNo: 6, newLineNo: null, content: 'const renderRow = (row: Row) => <GraphRow key={row.oid} row={row} />;' },
        { kind: 'addition', oldLineNo: null, newLineNo: 7, content: 'const renderRow = (item: VirtualItem, row: Row) => (' },
        { kind: 'addition', oldLineNo: null, newLineNo: 8, content: '  <GraphRow key={row.oid} row={row} start={item.start} />' },
        { kind: 'addition', oldLineNo: null, newLineNo: 9, content: ');' },
      ],
    },
    {
      header: '@@ -24,9 +25,12 @@ export function CommitGraph() {',
      oldStart: 24,
      oldLines: 9,
      newStart: 25,
      newLines: 12,
      lines: [
        { kind: 'context', oldLineNo: 24, newLineNo: 25, content: 'const rows = useGraphRows();' },
        { kind: 'deletion', oldLineNo: 25, newLineNo: null, content: 'const height = rows.length * ROW_HEIGHT;' },
        { kind: 'addition', oldLineNo: null, newLineNo: 26, content: 'const virtualizer = useVirtualizer({' },
        { kind: 'addition', oldLineNo: null, newLineNo: 27, content: '  count: rows.length,' },
        { kind: 'addition', oldLineNo: null, newLineNo: 28, content: '  estimateSize: () => ROW_HEIGHT,' },
        { kind: 'addition', oldLineNo: null, newLineNo: 29, content: '  overscan: OVERSCAN,' },
        { kind: 'addition', oldLineNo: null, newLineNo: 30, content: '});' },
        { kind: 'context', oldLineNo: 26, newLineNo: 31, content: 'return (' },
        { kind: 'deletion', oldLineNo: 27, newLineNo: null, content: '  <div style={{ height }}>' },
        { kind: 'deletion', oldLineNo: 28, newLineNo: null, content: '    {rows.map(renderRow)}' },
        { kind: 'addition', oldLineNo: null, newLineNo: 32, content: '  <div style={{ height: virtualizer.getTotalSize() }}>' },
        { kind: 'addition', oldLineNo: null, newLineNo: 33, content: '    {virtualizer.getVirtualItems().map((item) => renderRow(item, rows[item.index]))}' },
        { kind: 'context', oldLineNo: 29, newLineNo: 34, content: '  </div>' },
      ],
    },
    {
      header: '@@ -41,6 +47,10 @@ export function CommitGraph() {',
      oldStart: 41,
      oldLines: 6,
      newStart: 47,
      newLines: 10,
      lines: [
        { kind: 'context', oldLineNo: 41, newLineNo: 47, content: 'export function useGraphKeyboardNav(rows: Row[]) {' },
        { kind: 'context', oldLineNo: 42, newLineNo: 48, content: '  const select = useGraphStore((s) => s.select);' },
        { kind: 'deletion', oldLineNo: 43, newLineNo: null, content: "  useShortcut('ArrowDown', () => select(next()));" },
        { kind: 'addition', oldLineNo: null, newLineNo: 49, content: "  useShortcut('ArrowDown', () => select(clamp(next(), rows.length - 1)));" },
        { kind: 'addition', oldLineNo: null, newLineNo: 50, content: "  useShortcut('ArrowUp', () => select(clamp(prev(), 0)));" },
        { kind: 'addition', oldLineNo: null, newLineNo: 51, content: "  useShortcut('Home', () => select(0));" },
        { kind: 'addition', oldLineNo: null, newLineNo: 52, content: "  useShortcut('End', () => select(rows.length - 1));" },
        { kind: 'context', oldLineNo: 44, newLineNo: 53, content: '}' },
      ],
    },
  ],
};

function largeDiffRows(): FileDiff['hunks'][number]['lines'] {
  const rows: FileDiff['hunks'][number]['lines'] = [];
  let oldNo = 1;
  let newNo = 1;
  const hex = (n: number) => `#${((n * 48271) % 0xffffff).toString(16).padStart(6, '0')}`;
  const context = (n: number) =>
    rows.push({
      kind: 'context',
      oldLineNo: oldNo++,
      newLineNo: newNo++,
      content: `INSERT INTO palette (id, hex) VALUES (${n}, '${hex(n)}');`,
    });
  for (let n = 1; n <= 480; n += 1) context(n);
  rows.push({
    kind: 'deletion',
    oldLineNo: oldNo++,
    newLineNo: null,
    content: `INSERT INTO palette (id, hex) VALUES (481, '${hex(481)}');`,
  });
  rows.push({
    kind: 'deletion',
    oldLineNo: oldNo++,
    newLineNo: null,
    content: `INSERT INTO palette (id, hex) VALUES (482, '${hex(482)}');`,
  });
  rows.push({
    kind: 'addition',
    oldLineNo: null,
    newLineNo: newNo++,
    content: `INSERT INTO palette (id, hex, label) VALUES (481, '${hex(481)}', 'temple gold');`,
  });
  rows.push({
    kind: 'addition',
    oldLineNo: null,
    newLineNo: newNo++,
    content: `INSERT INTO palette (id, hex, label) VALUES (482, '${hex(482)}', 'angkor dusk');`,
  });
  rows.push({
    kind: 'addition',
    oldLineNo: null,
    newLineNo: newNo++,
    content: `INSERT INTO palette (id, hex, label) VALUES (483, '${hex(483)}', 'lotus pink');`,
  });
  for (let n = 483; n <= 520; n += 1) context(n);
  return rows;
}

export const demoLargeFileDiff: FileDiff = {
  path: 'src/data/palette-seed.sql',
  oldPath: null,
  status: 'modified',
  isBinary: false,
  isImage: false,
  oldImage: null,
  newImage: null,
  additions: 3,
  deletions: 2,
  hunks: [
    {
      header: '@@ -1,520 +1,521 @@',
      oldStart: 1,
      oldLines: 520,
      newStart: 1,
      newLines: 521,
      lines: largeDiffRows(),
    },
  ],
};

export function demoFileDiffFor(path: string): FileDiff {
  if (path === demoLargeFileDiff.path) return demoLargeFileDiff;
  return { ...demoFileDiff, path };
}

export function demoCommitDiff(): FileDiff[] {
  return [demoFileDiff];
}

export const demoConflictContent = `import { render } from './renderer';

export function drawGraph(rows: Row[]) {
<<<<<<< HEAD
  const palette = useThemePalette();
  return render(rows, { palette, animate: true });
=======
  const colors = legacyColors();
  return render(rows, { colors });
>>>>>>> feature/lane-colors
}
`;

export const demoCliAgents: CliAgentInfo[] = [
  { id: 'claude', label: 'Claude Code', path: '/usr/local/bin/claude', version: '2.0.0 (demo)' },
];

export function demoCliRun(): CliRunResult {
  return {
    status: 0,
    stdout: 'feat: demo response — connect a real AI CLI in the desktop app',
    stderr: '',
    output: null,
  };
}
