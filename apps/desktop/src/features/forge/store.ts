import { create } from 'zustand';
import {
  createForgeProvider,
  parseForgeRemote,
  pickForgeRemote,
  type ForgeProvider,
  type ForgeRemote,
  type PullRequestInfo,
} from '@angkorgit/core';
import { ipc } from '@/core/ipc';
import { useRepo } from '@/features/repository/store';

const FRESH_MS = 60_000;

interface ForgeState {
  repoPath: string | null;
  remoteName: string | null;
  remoteUrl: string | null;
  remote: ForgeRemote | null;
  hasAccount: boolean;
  prs: PullRequestInfo[];
  loading: boolean;
  error: string | null;
  loadedAt: number | null;

  load: (force?: boolean) => Promise<void>;
  reset: () => void;
}

let requestSeq = 0;

function hostMatches(a: string, b: string): boolean {
  const strip = (host: string) => host.toLowerCase().split(':')[0];
  return strip(a) === strip(b);
}

export function forgeProviderFor(repoPath: string, remote: ForgeRemote): ForgeProvider | null {
  return createForgeProvider(remote, (request) => ipc.forgeRequest(repoPath, remote.host, request));
}

export const useForge = create<ForgeState>((set, get) => ({
  repoPath: null,
  remoteName: null,
  remoteUrl: null,
  remote: null,
  hasAccount: false,
  prs: [],
  loading: false,
  error: null,
  loadedAt: null,

  reset: () =>
    set({
      repoPath: null,
      remoteName: null,
      remoteUrl: null,
      remote: null,
      hasAccount: false,
      prs: [],
      loading: false,
      error: null,
      loadedAt: null,
    }),

  load: async (force = false) => {
    const { repo, remotes, branches } = useRepo.getState();
    const headUpstream = branches.find((b) => !b.isRemote && b.isHead)?.upstream ?? null;
    const origin = pickForgeRemote(remotes, headUpstream);
    if (!repo || !origin) {
      get().reset();
      return;
    }
    const path = repo.path;
    const remote = parseForgeRemote(origin.url);
    const provider = remote ? forgeProviderFor(path, remote) : null;
    if (!remote || !provider) {
      set({
        repoPath: path,
        remoteName: origin.name,
        remoteUrl: origin.url,
        remote: null,
        hasAccount: false,
        prs: [],
        loading: false,
        error: null,
        loadedAt: null,
      });
      return;
    }

    const state = get();
    const sameTarget = state.repoPath === path && state.remoteUrl === origin.url;
    const fresh = sameTarget && state.loadedAt !== null && Date.now() - state.loadedAt < FRESH_MS;
    if (!force && (fresh || (sameTarget && state.loading))) return;

    const token = ++requestSeq;
    set({
      repoPath: path,
      remoteName: origin.name,
      remoteUrl: origin.url,
      remote,
      loading: true,
      error: null,
      ...(sameTarget ? {} : { prs: [], hasAccount: false, loadedAt: null }),
    });

    const stillCurrent = () => token === requestSeq && useRepo.getState().repo?.path === path;
    try {
      const accounts = await ipc.accountList();
      if (!stillCurrent()) return;
      const hasAccount = accounts.some((account) => hostMatches(account.host, remote.host));
      if (!hasAccount) {
        set({ hasAccount: false, prs: [], loading: false, loadedAt: Date.now() });
        return;
      }
      const prs = await provider.listOpenPullRequests();
      if (!stillCurrent()) return;
      set({ hasAccount: true, prs, loading: false, error: null, loadedAt: Date.now() });
    } catch (error) {
      if (!stillCurrent()) return;
      set({
        hasAccount: true,
        loading: false,
        error: (error as { message?: string }).message ?? String(error),
        loadedAt: Date.now(),
      });
    }
  },
}));
