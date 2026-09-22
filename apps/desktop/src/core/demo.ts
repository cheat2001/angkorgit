import type { EditorInfo } from './ipc';
import type { BlameHunk, FileBlame } from '@angkorgit/core';
import type {
  BranchInfo,
  CliAgentInfo,
  CliRunResult,
  CommitFileInfo,
  CommitInfo,
  FileDiff,
  HistoryPage,
  HistoryQuery,
  HttpRequest,
  HttpResponse,
  RecentRepository,
  RepositoryInfo,
  StashInfo,
  StatusSummary,
  TagInfo,
  WorktreeInfo,
  HistoryPosition,
  HistorySearch,
  HistorySearchQuery,
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
              { kind: 'localBranch', name: 'refs/heads/hotfix/lane-colors', shorthand: 'hotfix/lane-colors' },
              { kind: 'localBranch', name: 'refs/heads/main', shorthand: 'main' },
            ]
          : i === 2
            ? [
                { kind: 'remoteBranch', name: 'refs/remotes/origin/main', shorthand: 'origin/main' },
                { kind: 'tag', name: 'refs/tags/v0.4.0', shorthand: 'v0.4.0' },
              ]
            : i === 5
              ? [{ kind: 'stash', name: 'stash@{0}', shorthand: 'WIP on main: experiment with lane colors' }]
              : i === 7
                ? [
                    { kind: 'localBranch', name: 'refs/heads/feature/diff-viewer', shorthand: 'feature/diff-viewer' },
                    { kind: 'localBranch', name: 'refs/heads/release/0.4', shorthand: 'release/0.4' },
                  ]
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
  isWorktree: false,
  mainPath: null,
};

export const DEMO_LESS_PATH = 'styles/theme.less';
export const DEMO_DOCKERFILE_PATH = 'Dockerfile';

export const demoRecents: RecentRepository[] = [
  { path: '/Users/demo/projects/angkorgit', name: 'angkorgit', lastOpenedAt: 1754200000 },
  { path: '/Users/demo/projects/temple-ui', name: 'temple-ui', lastOpenedAt: 1754100000 },
  { path: '/Users/demo/work/api-gateway', name: 'api-gateway', lastOpenedAt: 1753900000 },
];

export const demoFonts = [
  { family: 'Fira Code', monospaced: true },
  { family: 'Helvetica Neue', monospaced: false },
  { family: 'Inter', monospaced: false },
  { family: 'JetBrains Mono', monospaced: true },
  { family: 'Menlo', monospaced: true },
  { family: 'Monaco', monospaced: true },
  { family: 'SF Mono', monospaced: true },
];

export function demoUnpushed(): string[] {
  const remote = ALL_COMMITS.findIndex((c) => c.refs.some((ref) => ref.kind === 'remoteBranch'));
  return ALL_COMMITS.slice(0, remote === -1 ? 0 : remote).map((c) => c.oid);
}

export function demoReword(oid: string, message: string): string {
  const commit = ALL_COMMITS.find((c) => c.oid === oid);
  if (!commit) throw new Error('commit not found');
  const newline = message.indexOf('\n');
  commit.summary = newline === -1 ? message : message.slice(0, newline);
  commit.body = newline === -1 ? '' : message.slice(newline + 1).replace(/^\n/, '');
  return oid;
}

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

export function demoHistorySearch(query: HistorySearchQuery): HistorySearch {
  const q = query.search.trim().toLowerCase();
  const author = query.author?.trim().toLowerCase() ?? '';
  const matches: HistoryPosition[] = [];
  if (q || author) {
    ALL_COMMITS.forEach((c, index) => {
      const textOk = !q || c.summary.toLowerCase().includes(q) || c.oid.includes(q);
      const authorOk = !author || c.author.name.toLowerCase().includes(author);
      if (textOk && authorOk) matches.push({ index, oid: c.oid });
    });
  }
  return { matches, truncated: false };
}

export function demoHistoryPosition(rev: string): { index: number; oid: string } | null {
  const needle = rev.trim().toLowerCase();
  const index = ALL_COMMITS.findIndex((c) => c.oid.startsWith(needle));
  return index === -1 ? null : { index, oid: ALL_COMMITS[index].oid };
}

export const demoStatus: StatusSummary = {
  files: [
    { path: 'src/features/graph/CommitGraph.tsx', origPath: null, staged: 'modified', unstaged: null },
    { path: 'src/core/ipc.ts', origPath: null, staged: null, unstaged: 'modified' },
    { path: 'src/data/palette-seed.sql', origPath: null, staged: null, unstaged: 'modified' },
    { path: 'docs/Architecture.md', origPath: null, staged: null, unstaged: 'untracked' },
    {
      path: 'src/features/repository/components/working-copy/deeply/nested/WorkingCopyFileListItemContainerFactory.tsx',
      origPath: null,
      staged: null,
      unstaged: 'untracked',
    },
    { path: 'src/old-layout.tsx', origPath: null, staged: 'deleted', unstaged: null },
    { path: DEMO_LESS_PATH, origPath: null, staged: null, unstaged: 'modified' },
    { path: DEMO_DOCKERFILE_PATH, origPath: null, staged: null, unstaged: 'untracked' },
  ],
  branch: 'main',
  ahead: 2,
  behind: 0,
};

export const demoBranches: BranchInfo[] = [
  { name: 'main', isHead: true, isRemote: false, upstream: 'origin/main', ahead: 2, behind: 0, targetOid: ALL_COMMITS[0].oid },
  { name: 'develop', isHead: false, isRemote: false, upstream: null, ahead: 0, behind: 0, targetOid: ALL_COMMITS[20].oid },
  { name: 'hotfix/lane-colors', isHead: false, isRemote: false, upstream: null, ahead: 0, behind: 0, targetOid: ALL_COMMITS[0].oid },
  { name: 'feature/diff-viewer', isHead: false, isRemote: false, upstream: null, ahead: 0, behind: 0, targetOid: ALL_COMMITS[7].oid },
  { name: 'release/0.4', isHead: false, isRemote: false, upstream: null, ahead: 0, behind: 0, targetOid: ALL_COMMITS[7].oid },
  { name: 'fix/stash-race', isHead: false, isRemote: false, upstream: null, ahead: 0, behind: 0, targetOid: ALL_COMMITS[12].oid },
  { name: 'origin/main', isHead: false, isRemote: true, upstream: null, ahead: 0, behind: 0, targetOid: ALL_COMMITS[2].oid },
];

const demoRefIndex = (name: string): number => {
  const oid = demoBranches.find((b) => b.name === name)?.targetOid ?? demoTags.find((t) => t.name === name)?.targetOid;
  return oid ? ALL_COMMITS.findIndex((c) => c.oid === oid) : -1;
};

export function demoCanFastForward(target: string, source: string): boolean {
  const targetIndex = demoRefIndex(target);
  const sourceIndex = demoRefIndex(source);
  return targetIndex >= 0 && sourceIndex >= 0 && sourceIndex < targetIndex;
}

export const demoTags: TagInfo[] = [
  { name: 'v0.4.0', targetOid: ALL_COMMITS[2].oid, message: 'Release 0.4.0', isAnnotated: true },
  { name: 'v0.3.0', targetOid: ALL_COMMITS[40].oid, message: null, isAnnotated: false },
];

export const demoWorktrees: WorktreeInfo[] = [
  {
    name: 'angkorgit',
    path: '/Users/demo/projects/angkorgit',
    branch: 'main',
    headOid: ALL_COMMITS[0].oid,
    isMain: true,
    isCurrent: true,
    isLocked: false,
    isDetached: false,
    isMissing: false,
    isDirty: null,
  },
  {
    name: 'angkorgit-feature-diff-viewer',
    path: '/Users/demo/projects/angkorgit-feature-diff-viewer',
    branch: 'feature/diff-viewer',
    headOid: ALL_COMMITS[7].oid,
    isMain: false,
    isCurrent: false,
    isLocked: false,
    isDetached: false,
    isMissing: false,
    isDirty: true,
  },
  {
    name: 'angkorgit-fix-stash-race',
    path: '/Users/demo/projects/angkorgit-fix-stash-race',
    branch: 'fix/stash-race',
    headOid: ALL_COMMITS[12].oid,
    isMain: false,
    isCurrent: false,
    isLocked: false,
    isDetached: false,
    isMissing: true,
    isDirty: null,
  },
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
      header: '@@ -1,8 +1,12 @@',
      oldStart: 1,
      oldLines: 8,
      newStart: 1,
      newLines: 12,
      lines: [
        { kind: 'context', oldLineNo: 1, newLineNo: 1, content: "import { memo } from 'react';" },
        { kind: 'deletion', oldLineNo: 2, newLineNo: null, content: "import { ROW_HEIGHT } from './constants';" },
        { kind: 'addition', oldLineNo: null, newLineNo: 2, content: "import { useVirtualizer } from '@tanstack/react-virtual';" },
        { kind: 'addition', oldLineNo: null, newLineNo: 3, content: "import { ROW_HEIGHT, OVERSCAN } from './constants';" },
        { kind: 'context', oldLineNo: 3, newLineNo: 4, content: "import { useGraphRows } from './store';" },
        { kind: 'context', oldLineNo: 4, newLineNo: 5, content: "import { GraphRow } from './GraphRow';" },
        { kind: 'context', oldLineNo: 5, newLineNo: 6, content: '' },
        { kind: 'deletion', oldLineNo: 6, newLineNo: null, content: 'const renderRow = (row: Row) => <GraphRow key={row.oid} row={row} />;' },
        { kind: 'addition', oldLineNo: null, newLineNo: 7, content: '/**' },
        { kind: 'addition', oldLineNo: null, newLineNo: 8, content: ' * Virtualized rows keep large graphs smooth for every export and import.' },
        { kind: 'addition', oldLineNo: null, newLineNo: 9, content: ' */' },
        { kind: 'addition', oldLineNo: null, newLineNo: 10, content: 'const renderRow = (item: VirtualItem, row: Row) => (' },
        { kind: 'addition', oldLineNo: null, newLineNo: 11, content: '  <GraphRow key={row.oid} row={row} start={item.start} />' },
        { kind: 'addition', oldLineNo: null, newLineNo: 12, content: ');' },
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

function demoStatusDiff(
  path: string,
  status: FileDiff['status'],
  rows: Array<readonly [' ' | '-' | '+', string]>,
): FileDiff {
  let oldNo = status === 'new' ? 0 : 1;
  let newNo = status === 'deleted' ? 0 : 1;
  let additions = 0;
  let deletions = 0;
  const lines = rows.map(([mark, content]) => {
    if (mark === '-') {
      deletions += 1;
      return { kind: 'deletion' as const, oldLineNo: oldNo++, newLineNo: null, content };
    }
    if (mark === '+') {
      additions += 1;
      return { kind: 'addition' as const, oldLineNo: null, newLineNo: newNo++, content };
    }
    return { kind: 'context' as const, oldLineNo: oldNo++, newLineNo: newNo++, content };
  });
  return {
    path,
    oldPath: null,
    status,
    isBinary: false,
    isImage: false,
    oldImage: null,
    newImage: null,
    additions,
    deletions,
    hunks: [
      {
        header: `@@ -${status === 'new' ? 0 : 1},${deletions} +${status === 'deleted' ? 0 : 1},${additions} @@`,
        oldStart: status === 'new' ? 0 : 1,
        oldLines: deletions,
        newStart: status === 'deleted' ? 0 : 1,
        newLines: additions,
        lines,
      },
    ],
  };
}

export function demoFileDiffFor(path: string): FileDiff {
  if (path === demoLargeFileDiff.path) return demoLargeFileDiff;
  if (path === DEMO_LESS_PATH) {
    return demoStatusDiff(path, 'modified', [
      [' ', '@accent: #2563eb;'],
      ['-', '.btn { color: #111; }'],
      ['+', '.btn {'],
      ['+', '  color: @accent;'],
      ['+', '  &:hover { color: darken(@accent, 8%); }'],
      ['+', '}'],
    ]);
  }
  if (path === DEMO_DOCKERFILE_PATH) {
    return demoStatusDiff(path, 'new', [
      ['+', 'FROM node:20-alpine'],
      ['+', 'WORKDIR /app'],
      ['+', 'COPY package.json bun.lock ./'],
      ['+', 'RUN bun install --frozen-lockfile'],
      ['+', 'COPY . .'],
      ['+', 'CMD ["bun", "run", "dev"]'],
    ]);
  }
  return { ...demoFileDiff, path };
}

export function demoCommitDiff(): FileDiff[] {
  return [demoFileDiff];
}

export function demoCommitFiles(): CommitFileInfo[] {
  const extra: CommitFileInfo[] = [
    { path: 'src/features/graph/GraphRow.tsx', oldPath: null, status: 'modified', isBinary: false, isImage: false, additions: 12, deletions: 4 },
    { path: 'src/features/graph/store.ts', oldPath: null, status: 'modified', isBinary: false, isImage: false, additions: 3, deletions: 1 },
    { path: 'docs/Architecture.md', oldPath: null, status: 'modified', isBinary: false, isImage: false, additions: 9, deletions: 0 },
    { path: 'tests/unit/graphLayout.test.ts', oldPath: null, status: 'new', isBinary: false, isImage: false, additions: 40, deletions: 0 },
  ];
  return [
    ...demoCommitDiff().map((diff) => ({
      path: diff.path,
      oldPath: diff.oldPath,
      status: diff.status === 'unchanged' ? 'modified' : diff.status,
      isBinary: diff.isBinary,
      isImage: diff.isImage,
      additions: diff.additions,
      deletions: diff.deletions,
    })),
    ...extra,
  ];
}

const demoLaneColorsConflict = `import type { Lane } from './types';
import { paletteFor } from './palette';

const FALLBACK = '#888888';

export function laneColor(lane: Lane, palette: string[]): string {
<<<<<<< HEAD
  if (palette.length === 0) return FALLBACK;
  return palette[lane.index % palette.length];
=======
  const index = lane.index % Math.max(palette.length, 1);
  return palette[index] ?? FALLBACK;
>>>>>>> feature/lane-colors
}

export function laneWidth(count: number): number {
  const base = 20;
<<<<<<< HEAD
  const min = 11;
  const max = 190;
  return Math.max(min, Math.min(base, Math.floor(max / Math.max(count, 1))));
=======
  return Math.max(11, Math.min(base, Math.floor(190 / Math.max(count, 1))));
>>>>>>> feature/lane-colors
}

export function laneLabel(lane: Lane): string {
<<<<<<< HEAD
  return \`lane \${lane.index + 1}\`;
=======
>>>>>>> feature/lane-colors
}

export const defaultPalette = paletteFor('angkor-dusk');
`;

const DEMO_CONFLICT_FILES = new Map<string, string>();

export function demoConflicts(): string[] {
  return [...DEMO_CONFLICT_FILES.keys()];
}

export function demoConflictFile(file: string): string {
  return DEMO_CONFLICT_FILES.get(file) ?? '';
}

export function resolveDemoConflict(file: string): void {
  DEMO_CONFLICT_FILES.delete(file);
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

DEMO_CONFLICT_FILES.set('src/features/graph/drawGraph.ts', demoConflictContent);
DEMO_CONFLICT_FILES.set('src/features/graph/laneColors.ts', demoLaneColorsConflict);

const demoPull = (
  number: number,
  title: string,
  branch: string,
  author: string,
  draft: boolean,
  fork: boolean,
) => ({
  number,
  title,
  html_url: `https://github.com/demo/angkorgit/pull/${number}`,
  state: 'open',
  draft,
  merged_at: null,
  created_at: '2026-08-18T09:00:00Z',
  updated_at: '2026-08-21T14:00:00Z',
  user: { login: author, avatar_url: null },
  head: {
    ref: branch,
    sha: ALL_COMMITS[7].oid,
    repo: { full_name: fork ? `${author}/angkorgit` : 'demo/angkorgit' },
  },
  base: { ref: 'main' },
});

export function demoForgeResponse(request: HttpRequest): HttpResponse {
  const url = request.url;
  if (request.method === 'POST' && url.includes('/pulls')) {
    const payload = JSON.parse(request.body ?? '{}') as { title?: string; head?: string; draft?: boolean };
    return {
      status: 201,
      body: JSON.stringify(
        demoPull(99, payload.title ?? 'New pull request', payload.head ?? 'feature/demo', 'demo-user', payload.draft === true, false),
      ),
    };
  }
  if (url.includes('/collaborators')) {
    return {
      status: 200,
      body: JSON.stringify([
        { login: 'sokha', name: 'Sokha Chan', avatar_url: null },
        { login: 'dara', name: 'Dara Kim', avatar_url: null },
        { login: 'maly', name: 'Maly Sok', avatar_url: null },
      ]),
    };
  }
  if (url.includes('/pulls')) {
    return {
      status: 200,
      body: JSON.stringify([
        demoPull(12, 'feat(diff): side-by-side word diff polish', 'feature/diff-viewer', 'dara', false, false),
        demoPull(11, 'fix(stash): apply race on fast repos', 'fix/stash-race', 'maly', true, false),
        demoPull(9, 'docs: translate first-launch guide', 'docs/khmer-guide', 'sokha', false, true),
      ]),
    };
  }
  return { status: 200, body: JSON.stringify({ default_branch: 'main' }) };
}

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

export const demoEditors: EditorInfo[] = [
  { id: 'vscode', label: 'Visual Studio Code', path: '/usr/local/bin/code', launch: 'binary' },
  { id: 'zed', label: 'Zed', path: '/Applications/Zed.app', launch: 'app' },
];

export function demoBlame(file: string, rev: string | null): FileBlame {
  const lines = demoConflictContent.split('\n');
  const hunks: BlameHunk[] = [];
  let line = 1;
  let i = 0;
  while (line <= lines.length) {
    const commit = ALL_COMMITS[(i * 3) % 7];
    const count = Math.min(lines.length - line + 1, 2 + (i % 4));
    hunks.push({
      oid: commit.oid,
      shortOid: commit.shortOid,
      summary: commit.summary,
      authorName: commit.author.name,
      authorEmail: commit.author.email,
      time: commit.author.time,
      startLine: line,
      lineCount: count,
      committed: true,
    });
    line += count;
    i += 1;
  }
  if (!rev && hunks.length > 0) {
    const last = hunks[hunks.length - 1];
    hunks[hunks.length - 1] = {
      ...last,
      oid: '0'.repeat(40),
      shortOid: '0000000',
      summary: 'Uncommitted changes',
      authorName: 'Not committed yet',
      authorEmail: '',
      committed: false,
    };
  }
  return { path: file, rev, lines, hunks };
}

const DEMO_TREE_FILES = [
  'README.md',
  'LICENSE',
  'package.json',
  'pnpm-workspace.yaml',
  '.github/workflows/ci.yml',
  'src/main.tsx',
  'src/app/App.tsx',
  'src/app/globals.css',
  'src/core/ipc.ts',
  'src/core/demo.ts',
  'src/features/graph/CommitGraph.tsx',
  'src/features/graph/layout.ts',
  'src/features/diff/DiffPanel.tsx',
  'src/features/diff/DiffViewer.tsx',
  'docs/Roadmap.md',
  'docs/Architecture.md',
  'tests/unit/wordDiff.test.ts',
  'packages/core/src/index.ts',
];

export function demoTreeFiles(): string[] {
  const changed = demoCommitFiles()
    .filter((f) => f.status !== 'deleted')
    .map((f) => f.path);
  return [...new Set([...DEMO_TREE_FILES, ...changed])].sort();
}

export function demoIndexFiles(): string[] {
  const tracked = demoStatus.files
    .filter((f) => f.unstaged !== 'untracked' && f.staged !== 'deleted')
    .map((f) => f.path);
  return [...new Set([...DEMO_TREE_FILES, ...tracked])].sort();
}

export function demoFileContents(file: string): FileDiff {
  const lines = demoConflictContent.split('\n');
  return {
    path: file,
    oldPath: null,
    status: 'unchanged',
    hunks: [
      {
        header: '',
        oldStart: 1,
        oldLines: lines.length,
        newStart: 1,
        newLines: lines.length,
        lines: lines.map((content, i) => ({ kind: 'context', oldLineNo: i + 1, newLineNo: i + 1, content })),
      },
    ],
    isBinary: false,
    isImage: false,
    oldImage: null,
    newImage: null,
    additions: 0,
    deletions: 0,
  };
}
