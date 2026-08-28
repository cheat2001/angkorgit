
export interface RepositoryInfo {
  path: string;
  name: string;
  headBranch: string | null;
  headOid: string | null;
  isDetached: boolean;
  isBare: boolean;
  state: RepoState;
}

export type RepoState =
  | 'clean'
  | 'merge'
  | 'rebase'
  | 'cherrypick'
  | 'revert'
  | 'bisect';

export interface RecentRepository {
  path: string;
  name: string;
  lastOpenedAt: number;
}

export interface Signature {
  name: string;
  email: string;
  time: number;
}

export interface CommitInfo {
  oid: string;
  shortOid: string;
  summary: string;
  body: string;
  author: Signature;
  committer: Signature;
  parents: string[];
  refs: RefInfo[];
  isHead: boolean;
}

export type RefKind = 'localBranch' | 'remoteBranch' | 'tag' | 'head' | 'stash';

export interface RefInfo {
  kind: RefKind;
  name: string;
  shorthand: string;
}

export interface BranchInfo {
  name: string;
  isHead: boolean;
  isRemote: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  targetOid: string;
}

export interface TagInfo {
  name: string;
  targetOid: string;
  message: string | null;
  isAnnotated: boolean;
}

export interface StashInfo {
  index: number;
  message: string;
  oid: string;
}

export interface RemoteInfo {
  name: string;
  url: string;
}

export interface SubmoduleInfo {
  name: string;
  path: string;
  url: string | null;
  headOid: string | null;
}

export type FileStatusKind =
  | 'new'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'typechange'
  | 'conflicted'
  | 'untracked';

export interface FileStatus {
  path: string;
  origPath: string | null;
  staged: FileStatusKind | null;
  unstaged: FileStatusKind | null;
}

export interface StatusSummary {
  files: FileStatus[];
  branch: string | null;
  ahead: number;
  behind: number;
}

export type DiffLineKind = 'context' | 'addition' | 'deletion';

export interface DiffLine {
  kind: DiffLineKind;
  oldLineNo: number | null;
  newLineNo: number | null;
  content: string;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  oldPath: string | null;
  status: 'new' | 'modified' | 'deleted' | 'renamed';
  hunks: DiffHunk[];
  isBinary: boolean;
  isImage: boolean;
  oldImage: string | null;
  newImage: string | null;
  additions: number;
  deletions: number;
}

export interface ConflictFile {
  path: string;
  content: string;
  hasMarkers: boolean;
}

export interface HistoryQuery {
  skip: number;
  limit: number;
  search?: string;
  author?: string;
  branch?: string;
}

export interface HistoryPage {
  commits: CommitInfo[];
  hasMore: boolean;
  total: number | null;
}

export interface HistoryPosition {
  index: number;
  oid: string;
}

export type RebaseTodoAction = 'pick' | 'reword' | 'squash' | 'fixup' | 'drop';

export interface RebaseTodoEntry {
  oid: string;
  action: RebaseTodoAction;
  message?: string;
}
