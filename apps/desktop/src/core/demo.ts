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
  isBinary: false,
  isImage: false,
  oldImage: null,
  newImage: null,
  additions: 6,
  deletions: 3,
  hunks: [
    {
      header: '@@ -24,9 +24,12 @@ export function CommitGraph() {',
      oldStart: 24,
      oldLines: 9,
      newStart: 24,
      newLines: 12,
      lines: [
        { kind: 'context', oldLineNo: 24, newLineNo: 24, content: 'const rows = useGraphRows();' },
        { kind: 'deletion', oldLineNo: 25, newLineNo: null, content: 'const height = rows.length * ROW_HEIGHT;' },
        { kind: 'addition', oldLineNo: null, newLineNo: 25, content: 'const virtualizer = useVirtualizer({' },
        { kind: 'addition', oldLineNo: null, newLineNo: 26, content: '  count: rows.length,' },
        { kind: 'addition', oldLineNo: null, newLineNo: 27, content: '  estimateSize: () => ROW_HEIGHT,' },
        { kind: 'addition', oldLineNo: null, newLineNo: 28, content: '});' },
        { kind: 'context', oldLineNo: 26, newLineNo: 29, content: 'return (' },
        { kind: 'deletion', oldLineNo: 27, newLineNo: null, content: '  <div style={{ height }}>' },
        { kind: 'deletion', oldLineNo: 28, newLineNo: null, content: '    {rows.map(renderRow)}' },
        { kind: 'addition', oldLineNo: null, newLineNo: 30, content: '  <div style={{ height: virtualizer.getTotalSize() }}>' },
        { kind: 'addition', oldLineNo: null, newLineNo: 31, content: '    {virtualizer.getVirtualItems().map(renderRow)}' },
        { kind: 'context', oldLineNo: 29, newLineNo: 32, content: '  </div>' },
      ],
    },
  ],
};

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
