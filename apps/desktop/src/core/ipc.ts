import type {
  BranchInfo,
  CommitInfo,
  ConflictFile,
  FileDiff,
  HistoryPage,
  HistoryQuery,
  HttpRequest,
  HttpResponse,
  RecentRepository,
  RemoteInfo,
  RepositoryInfo,
  StashInfo,
  StatusSummary,
  SubmoduleInfo,
  TagInfo,
} from '@angkorgit/core';
import * as demo from './demo';

/**
 * Typed IPC boundary. In Tauri, commands go to the Rust engine; in a plain
 * browser (UI development, Playwright) a deterministic demo backend answers,
 * so every screen is testable without a native build.
 */

export interface OpOutcome {
  status: 'ok' | 'conflicts' | 'up_to_date' | 'fast_forward';
  message: string;
}

export interface IpcError {
  code: string;
  message: string;
}

export const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

export async function listen(event: string, handler: (payload: unknown) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen(event, (e) => handler(e.payload));
  return unlisten;
}

const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms));

export const ipc = {
  // ---- repository ----
  async openRepository(path: string): Promise<RepositoryInfo> {
    if (!isTauri()) {
      await delay();
      return demo.demoRepo;
    }
    return invoke('repo_open', { path });
  },
  async repoInfo(path: string): Promise<RepositoryInfo> {
    if (!isTauri()) return demo.demoRepo;
    return invoke('repo_info', { path });
  },
  async initRepository(path: string): Promise<RepositoryInfo> {
    if (!isTauri()) return demo.demoRepo;
    return invoke('repo_init', { path });
  },
  async cloneRepository(url: string, into: string): Promise<string> {
    if (!isTauri()) {
      await delay(600);
      return demo.demoRepo.path;
    }
    return invoke('repo_clone', { url, into });
  },
  async status(path: string): Promise<StatusSummary> {
    if (!isTauri()) return demo.demoStatus;
    return invoke('repo_status', { path });
  },
  async recentRepositories(): Promise<RecentRepository[]> {
    if (!isTauri()) return demo.demoRecents;
    return invoke('recent_repositories');
  },
  async removeRecent(path: string): Promise<RecentRepository[]> {
    if (!isTauri()) return demo.demoRecents.filter((r) => r.path !== path);
    return invoke('recent_remove', { path });
  },

  // ---- config ----
  async configGet(path: string | null, key: string): Promise<string | null> {
    if (!isTauri()) return key === 'user.name' ? 'Demo User' : key === 'user.email' ? 'demo@angkorgit.dev' : null;
    return invoke('config_get', { path, key });
  },
  async configSet(path: string | null, key: string, value: string, global: boolean): Promise<void> {
    if (!isTauri()) return;
    return invoke('config_set', { path, key, value, global });
  },

  // ---- staging / commit ----
  async stageFile(path: string, file: string): Promise<void> {
    if (!isTauri()) return;
    return invoke('stage_file', { path, file });
  },
  async unstageFile(path: string, file: string): Promise<void> {
    if (!isTauri()) return;
    return invoke('unstage_file', { path, file });
  },
  async stageAll(path: string): Promise<void> {
    if (!isTauri()) return;
    return invoke('stage_all', { path });
  },
  async unstageAll(path: string): Promise<void> {
    if (!isTauri()) return;
    return invoke('unstage_all', { path });
  },
  async discardFile(path: string, file: string): Promise<void> {
    if (!isTauri()) return;
    return invoke('discard_file', { path, file });
  },
  async stageHunk(path: string, file: string, hunkIndex: number): Promise<void> {
    if (!isTauri()) return;
    return invoke('stage_hunk', { path, file, hunkIndex });
  },
  async unstageHunk(path: string, file: string, hunkIndex: number): Promise<void> {
    if (!isTauri()) return;
    return invoke('unstage_hunk', { path, file, hunkIndex });
  },
  async commit(path: string, message: string): Promise<string> {
    if (!isTauri()) {
      await delay(200);
      return 'demo-commit-oid';
    }
    return invoke('commit_create', { path, message });
  },
  async amend(path: string, message: string | null): Promise<string> {
    if (!isTauri()) return 'demo-amend-oid';
    return invoke('commit_amend', { path, message });
  },

  // ---- history ----
  async history(path: string, query: HistoryQuery): Promise<HistoryPage> {
    if (!isTauri()) {
      await delay(60);
      return demo.demoHistory(query);
    }
    return invoke('history_list', { path, query });
  },
  async commitInfo(path: string, oid: string): Promise<CommitInfo> {
    if (!isTauri()) return demo.demoHistory({ skip: 0, limit: 1 }).commits[0];
    return invoke('history_commit', { path, oid });
  },

  // ---- branches ----
  async branches(path: string): Promise<BranchInfo[]> {
    if (!isTauri()) return demo.demoBranches;
    return invoke('branch_list', { path });
  },
  async createBranch(path: string, name: string, fromOid: string | null, checkout: boolean): Promise<void> {
    if (!isTauri()) return;
    return invoke('branch_create', { path, name, fromOid, checkout });
  },
  async deleteBranch(path: string, name: string, remote: boolean): Promise<void> {
    if (!isTauri()) return;
    return invoke('branch_delete', { path, name, remote });
  },
  async renameBranch(path: string, oldName: string, newName: string): Promise<void> {
    if (!isTauri()) return;
    return invoke('branch_rename', { path, oldName, newName });
  },
  async checkout(path: string, name: string): Promise<void> {
    if (!isTauri()) return;
    return invoke('branch_checkout', { path, name });
  },
  async checkoutDetached(path: string, rev: string): Promise<void> {
    if (!isTauri()) return;
    return invoke('checkout_detached', { path, rev });
  },
  async merge(path: string, name: string): Promise<OpOutcome> {
    if (!isTauri()) return { status: 'ok', message: `Merged ${name} (demo)` };
    return invoke('branch_merge', { path, name });
  },
  async mergeAbort(path: string): Promise<void> {
    if (!isTauri()) return;
    return invoke('merge_abort', { path });
  },
  async rebase(path: string, upstream: string): Promise<OpOutcome> {
    if (!isTauri()) return { status: 'ok', message: `Rebased onto ${upstream} (demo)` };
    return invoke('branch_rebase', { path, upstream });
  },
  async rebaseContinue(path: string): Promise<OpOutcome> {
    if (!isTauri()) return { status: 'ok', message: 'Rebase complete (demo)' };
    return invoke('rebase_continue', { path });
  },
  async rebaseAbort(path: string): Promise<void> {
    if (!isTauri()) return;
    return invoke('rebase_abort', { path });
  },
  async cherryPick(path: string, oid: string): Promise<OpOutcome> {
    if (!isTauri()) return { status: 'ok', message: 'Cherry-picked (demo)' };
    return invoke('cherry_pick', { path, oid });
  },
  async reset(path: string, oid: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void> {
    if (!isTauri()) return;
    return invoke('reset_to', { path, oid, mode });
  },

  // ---- remotes ----
  async remotes(path: string): Promise<RemoteInfo[]> {
    if (!isTauri()) return [{ name: 'origin', url: 'git@github.com:demo/angkorgit.git' }];
    return invoke('remote_list', { path });
  },
  async fetch(path: string, remote: string, tags: boolean, prune: boolean): Promise<OpOutcome> {
    if (!isTauri()) {
      await delay(400);
      return { status: 'ok', message: `Fetched ${remote} (demo)` };
    }
    return invoke('remote_fetch', { path, remote, tags, prune });
  },
  async pull(path: string, remote: string): Promise<OpOutcome> {
    if (!isTauri()) {
      await delay(400);
      return { status: 'ok', message: 'Already up to date (demo)' };
    }
    return invoke('remote_pull', { path, remote });
  },
  async push(path: string, remote: string, force: boolean, withTags: boolean, setUpstream: boolean): Promise<OpOutcome> {
    if (!isTauri()) {
      await delay(400);
      return { status: 'ok', message: `Pushed to ${remote} (demo)` };
    }
    return invoke('remote_push', { path, remote, force, withTags, setUpstream });
  },
  async pushTag(path: string, remote: string, tag: string): Promise<OpOutcome> {
    if (!isTauri()) return { status: 'ok', message: `Pushed tag ${tag} (demo)` };
    return invoke('remote_push_tag', { path, remote, tag });
  },

  // ---- stash ----
  async stashes(path: string): Promise<StashInfo[]> {
    if (!isTauri()) return demo.demoStashes;
    return invoke('stash_list', { path });
  },
  async stashCreate(path: string, message: string | null, includeUntracked: boolean): Promise<void> {
    if (!isTauri()) return;
    return invoke('stash_create', { path, message, includeUntracked });
  },
  async stashApply(path: string, index: number): Promise<void> {
    if (!isTauri()) return;
    return invoke('stash_apply', { path, index });
  },
  async stashPop(path: string, index: number): Promise<void> {
    if (!isTauri()) return;
    return invoke('stash_pop', { path, index });
  },
  async stashDrop(path: string, index: number): Promise<void> {
    if (!isTauri()) return;
    return invoke('stash_drop', { path, index });
  },

  // ---- tags ----
  async tags(path: string): Promise<TagInfo[]> {
    if (!isTauri()) return demo.demoTags;
    return invoke('tag_list', { path });
  },
  async tagCreate(path: string, name: string, target: string | null, message: string | null): Promise<void> {
    if (!isTauri()) return;
    return invoke('tag_create', { path, name, target, message });
  },
  async tagDelete(path: string, name: string): Promise<void> {
    if (!isTauri()) return;
    return invoke('tag_delete', { path, name });
  },

  // ---- submodules ----
  async submodules(path: string): Promise<SubmoduleInfo[]> {
    if (!isTauri()) return [{ name: 'vendor/libfoo', path: 'vendor/libfoo', url: 'https://github.com/demo/libfoo', headOid: 'abc123' }];
    return invoke('submodule_list', { path });
  },
  async submoduleUpdate(path: string, name: string): Promise<void> {
    if (!isTauri()) return;
    return invoke('submodule_update', { path, name });
  },

  // ---- diff ----
  async diffFile(path: string, file: string, staged: boolean): Promise<FileDiff> {
    if (!isTauri()) return { ...demo.demoFileDiff, path: file };
    return invoke('diff_file', { path, file, staged });
  },
  async diffCommit(path: string, oid: string): Promise<FileDiff[]> {
    if (!isTauri()) return demo.demoCommitDiff();
    return invoke('diff_commit', { path, oid });
  },
  async stagedPatch(path: string): Promise<string> {
    if (!isTauri()) return '--- demo staged patch ---';
    return invoke('staged_patch', { path });
  },

  // ---- conflicts ----
  async conflicts(path: string): Promise<string[]> {
    if (!isTauri()) return [];
    return invoke('conflict_list', { path });
  },
  async conflictRead(path: string, file: string): Promise<ConflictFile> {
    if (!isTauri()) return { path: file, content: demo.demoConflictContent, hasMarkers: true };
    return invoke('conflict_read', { path, file });
  },
  async conflictResolve(path: string, file: string, content: string): Promise<void> {
    if (!isTauri()) return;
    return invoke('conflict_resolve', { path, file, content });
  },

  // ---- terminal ----
  async termCreate(cwd: string, cols: number, rows: number): Promise<number> {
    if (!isTauri()) return -1;
    return invoke('term_create', { cwd, cols, rows });
  },
  async termWrite(id: number, data: string): Promise<void> {
    if (!isTauri()) return;
    return invoke('term_write', { id, data });
  },
  async termResize(id: number, cols: number, rows: number): Promise<void> {
    if (!isTauri()) return;
    return invoke('term_resize', { id, cols, rows });
  },
  async termKill(id: number): Promise<void> {
    if (!isTauri()) return;
    return invoke('term_kill', { id });
  },

  // ---- AI transport ----
  async httpRequest(request: HttpRequest): Promise<HttpResponse> {
    if (!isTauri()) {
      const res = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
      });
      return { status: res.status, body: await res.text() };
    }
    return invoke('http_request', { request });
  },
};

/** Open a native folder picker (Tauri) or prompt (browser demo). */
export async function pickDirectory(title: string): Promise<string | null> {
  if (!isTauri()) {
    return window.prompt(`${title} — enter a path (demo mode)`) || null;
  }
  const { open } = await import('@tauri-apps/plugin-dialog');
  const result = await open({ directory: true, multiple: false, title });
  return typeof result === 'string' ? result : null;
}
