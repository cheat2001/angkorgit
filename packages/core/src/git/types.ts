/** Domain types shared between the Rust engine (serde) and the frontend. */

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
  /** Unix seconds */
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

// ---- Diff -----------------------------------------------------------------

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
  hunks: DiffHunk[];
  isBinary: boolean;
  isImage: boolean;
  /** base64 payloads for image diffs */
  oldImage: string | null;
  newImage: string | null;
  additions: number;
  deletions: number;
}

// ---- Conflicts -------------------------------------------------------------

export interface ConflictFile {
  path: string;
  content: string;
  hasMarkers: boolean;
}

// ---- History query ----------------------------------------------------------

export interface HistoryQuery {
  skip: number;
  limit: number;
  /** substring match against summary/body/oid */
  search?: string;
  author?: string;
  /** limit to a branch tip (ref name), otherwise all refs */
  branch?: string;
}

export interface HistoryPage {
  commits: CommitInfo[];
  hasMore: boolean;
  total: number | null;
}
