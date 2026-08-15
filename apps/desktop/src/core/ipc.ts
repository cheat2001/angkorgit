import type {
  BranchInfo,
  CliAgentInfo,
  CliRunRequest,
  CliRunResult,
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

export interface OpOutcome {
  status: 'ok' | 'conflicts' | 'up_to_date' | 'fast_forward';
  message: string;
}

export interface IpcError {
  code: string;
  message: string;
}

export interface GeneratedKey {
  path: string;
  publicKey: string;
}

export interface HostingAccount {
  host: string;
  username: string;
  provider: string;
  verified: boolean;
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

const DEMO_AI_KEYS = 'angkorgit-demo-ai-keys';

function demoAiKeys(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(DEMO_AI_KEYS) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function demoAiKeysSave(keys: Record<string, string>): void {
  localStorage.setItem(DEMO_AI_KEYS, JSON.stringify(keys));
}

export const ipc = {
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

  async configGet(path: string | null, key: string): Promise<string | null> {
    if (!isTauri()) return key === 'user.name' ? 'Demo User' : key === 'user.email' ? 'demo@angkorgit.dev' : null;
    return invoke('config_get', { path, key });
  },
  async configSet(path: string | null, key: string, value: string, global: boolean): Promise<void> {
    if (!isTauri()) return;
    return invoke('config_set', { path, key, value, global });
  },

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
  async discardFile(path: string, file: string): Promise<boolean> {
    if (!isTauri()) return true;
    return invoke('discard_file', { path, file });
  },
  async discardAll(path: string): Promise<string[]> {
    if (!isTauri()) return [];
    return invoke('discard_all', { path });
  },
  async stageHunk(path: string, file: string, hunkIndex: number): Promise<void> {
    if (!isTauri()) return;
    return invoke('stage_hunk', { path, file, hunkIndex });
  },
  async unstageHunk(path: string, file: string, hunkIndex: number): Promise<void> {
    if (!isTauri()) return;
    return invoke('unstage_hunk', { path, file, hunkIndex });
  },
  async stageLine(path: string, file: string, kind: string, lineNo: number): Promise<void> {
    if (!isTauri()) return;
    return invoke('stage_line', { path, file, kind, lineNo });
  },
  async unstageLine(path: string, file: string, kind: string, lineNo: number): Promise<void> {
    if (!isTauri()) return;
    return invoke('unstage_line', { path, file, kind, lineNo });
  },
  async discardLine(path: string, file: string, kind: string, lineNo: number): Promise<void> {
    if (!isTauri()) return;
    return invoke('discard_line', { path, file, kind, lineNo });
  },
  async readFile(path: string, file: string): Promise<string> {
    if (!isTauri()) return '// demo mode — editing is available in the desktop app\n';
    return invoke('read_file', { path, file });
  },
  async writeFile(path: string, file: string, content: string): Promise<void> {
    if (!isTauri()) return;
    return invoke('write_file', { path, file, content });
  },
  async openPath(target: string): Promise<void> {
    if (!isTauri()) return;
    return invoke('open_path', { path: target });
  },
  async revealPath(target: string): Promise<void> {
    if (!isTauri()) return;
    return invoke('reveal_path', { path: target });
  },
  async deleteFile(path: string, file: string): Promise<void> {
    if (!isTauri()) return;
    return invoke('delete_file', { path, file });
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
  async revert(path: string, oid: string): Promise<OpOutcome> {
    if (!isTauri()) return { status: 'ok', message: 'Reverted (demo)' };
    return invoke('commit_revert', { path, oid });
  },

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
  async fileHistory(
    path: string,
    file: string,
    limit?: number,
    skip?: number,
  ): Promise<HistoryPage> {
    if (!isTauri()) {
      await delay(60);
      return demo.demoHistory({ skip: skip ?? 0, limit: limit ?? 25 });
    }
    return invoke('history_file', { path, file, limit, skip });
  },
  async repoFiles(path: string): Promise<string[]> {
    if (!isTauri()) {
      return ['src/main.ts', 'src/app/App.tsx', 'src/graph/layout.ts', 'README.md', 'package.json'];
    }
    return invoke('repo_files', { path });
  },

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
  async merge(path: string, name: string, noFf = false): Promise<OpOutcome> {
    if (!isTauri()) return { status: 'ok', message: `Merged ${name} (demo)` };
    return invoke('branch_merge', { path, name, noFf });
  },
  async mergeAbort(path: string): Promise<void> {
    if (!isTauri()) return;
    return invoke('merge_abort', { path });
  },
  async mergeMessage(path: string): Promise<string | null> {
    if (!isTauri()) return null;
    return invoke('merge_message', { path });
  },
  async mergeCanFastForward(path: string, target: string, source: string): Promise<boolean> {
    if (!isTauri()) return false;
    return invoke('merge_can_ff', { path, target, source });
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

  async remotes(path: string): Promise<RemoteInfo[]> {
    if (!isTauri()) return [{ name: 'origin', url: 'git@github.com:demo/angkorgit.git' }];
    return invoke('remote_list', { path });
  },
  async remoteEdit(path: string, name: string, newName: string, url: string): Promise<void> {
    if (!isTauri()) return;
    return invoke('remote_edit', { path, name, newName, url });
  },
  async remoteRemove(path: string, name: string): Promise<void> {
    if (!isTauri()) return;
    return invoke('remote_remove', { path, name });
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
  async push(
    path: string,
    remote: string,
    force: boolean,
    withTags: boolean,
    setUpstream: boolean,
    branch?: string,
  ): Promise<OpOutcome> {
    if (!isTauri()) {
      await delay(400);
      return { status: 'ok', message: `Pushed to ${remote} (demo)` };
    }
    return invoke('remote_push', { path, remote, branch: branch ?? null, force, withTags, setUpstream });
  },
  async pullBranch(path: string, branch: string): Promise<OpOutcome> {
    if (!isTauri()) return { status: 'ok', message: `Pulled ${branch} (demo)` };
    return invoke('remote_pull_branch', { path, branch });
  },
  async pushTag(path: string, remote: string, tag: string): Promise<OpOutcome> {
    if (!isTauri()) return { status: 'ok', message: `Pushed tag ${tag} (demo)` };
    return invoke('remote_push_tag', { path, remote, tag });
  },

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

  async submodules(path: string): Promise<SubmoduleInfo[]> {
    if (!isTauri()) return [{ name: 'vendor/libfoo', path: 'vendor/libfoo', url: 'https://github.com/demo/libfoo', headOid: 'abc123' }];
    return invoke('submodule_list', { path });
  },
  async submoduleUpdate(path: string, name: string): Promise<void> {
    if (!isTauri()) return;
    return invoke('submodule_update', { path, name });
  },

  async diffFile(path: string, file: string, staged: boolean, contextLines?: number): Promise<FileDiff> {
    if (!isTauri()) return { ...demo.demoFileDiff, path: file };
    return invoke('diff_file', { path, file, staged, contextLines: contextLines ?? null });
  },
  async diffCommit(path: string, oid: string, contextLines?: number): Promise<FileDiff[]> {
    if (!isTauri()) return demo.demoCommitDiff();
    return invoke('diff_commit', { path, oid, contextLines: contextLines ?? null });
  },
  async stagedPatch(path: string): Promise<string> {
    if (!isTauri()) return '--- demo staged patch ---';
    return invoke('staged_patch', { path });
  },

  async conflicts(path: string): Promise<string[]> {
    if (!isTauri()) return ['src/features/graph/drawGraph.ts'];
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

  async watchRepo(path: string): Promise<void> {
    if (!isTauri()) return;
    return invoke('watch_repo', { path });
  },
  async watchStop(): Promise<void> {
    if (!isTauri()) return;
    return invoke('watch_stop');
  },

  async credentialStore(host: string, username: string, password: string): Promise<void> {
    if (!isTauri()) return;
    return invoke('credential_store', { host, username, password });
  },
  async setCredentialPrefs(
    sshKeyPath: string | null,
    useAgent: boolean,
    useCredentialHelper: boolean,
  ): Promise<void> {
    if (!isTauri()) return;
    return invoke('credential_prefs_set', { sshKeyPath, useAgent, useCredentialHelper });
  },
  async sshPublicKey(path: string): Promise<string> {
    if (!isTauri()) return 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5DEMO demo@angkorgit';
    return invoke('ssh_public_key', { path });
  },
  async sshKeyGenerate(path: string, comment: string): Promise<GeneratedKey> {
    if (!isTauri()) {
      return { path, publicKey: 'ssh-rsa AAAAB3NzaC1yc2EDEMO demo@angkorgit' };
    }
    return invoke('ssh_key_generate', { path, comment });
  },
  async accountList(): Promise<HostingAccount[]> {
    if (!isTauri())
      return [{ host: 'github.com', username: 'demo-user', provider: 'github', verified: true }];
    return invoke('account_list');
  },
  async accountAdd(
    host: string,
    username: string,
    provider: string,
    token: string,
    verified: boolean,
  ): Promise<HostingAccount[]> {
    if (!isTauri()) return [{ host, username, provider, verified }];
    return invoke('account_add', { host, username, provider, token, verified });
  },
  async accountRemove(host: string): Promise<HostingAccount[]> {
    if (!isTauri()) return [];
    return invoke('account_remove', { host });
  },

  async aiKeyGet(provider: string): Promise<string | null> {
    if (!isTauri()) return demoAiKeys()[provider] ?? null;
    return invoke('ai_key_get', { provider });
  },
  async aiKeySet(provider: string, key: string): Promise<void> {
    if (!isTauri()) {
      const keys = demoAiKeys();
      if (key.trim()) keys[provider] = key.trim();
      else delete keys[provider];
      demoAiKeysSave(keys);
      return;
    }
    return invoke('ai_key_set', { provider, key });
  },
  async aiKeyDelete(provider: string): Promise<void> {
    if (!isTauri()) {
      const keys = demoAiKeys();
      delete keys[provider];
      demoAiKeysSave(keys);
      return;
    }
    return invoke('ai_key_delete', { provider });
  },

  async aiCliDetect(): Promise<CliAgentInfo[]> {
    if (!isTauri()) {
      await delay(300);
      return demo.demoCliAgents;
    }
    return invoke('ai_cli_detect');
  },
  async aiCliRun(request: CliRunRequest): Promise<CliRunResult> {
    if (!isTauri()) {
      await delay(600);
      return demo.demoCliRun();
    }
    return invoke('ai_cli_run', { request });
  },

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

export async function openExternal(url: string): Promise<void> {
  if (!isTauri()) {
    window.open(url, '_blank');
    return;
  }
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(url);
}

export async function appVersion(): Promise<string> {
  if (!isTauri()) return 'dev';
  const { getVersion } = await import('@tauri-apps/api/app');
  return getVersion();
}

export async function pickDirectory(title: string): Promise<string | null> {
  if (!isTauri()) {
    return window.prompt(`${title} — enter a path (demo mode)`) || null;
  }
  const { open } = await import('@tauri-apps/plugin-dialog');
  const result = await open({ directory: true, multiple: false, title });
  return typeof result === 'string' ? result : null;
}

export async function pickFile(title: string, defaultPath?: string): Promise<string | null> {
  if (!isTauri()) {
    return window.prompt(`${title} — enter a path (demo mode)`) || null;
  }
  const { open } = await import('@tauri-apps/plugin-dialog');
  const result = await open({ directory: false, multiple: false, title, defaultPath });
  return typeof result === 'string' ? result : null;
}
