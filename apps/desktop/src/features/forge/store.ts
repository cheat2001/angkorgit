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

interface ForgeSnapshot {
  remoteName: string;
  remoteUrl: string;
  remote: ForgeRemote | null;
  hasAccount: boolean;
  prs: PullRequestInfo[];
  error: string | null;
  errorDetail: string | null;
  loadedAt: number | null;
}

interface ForgeState {
  repoPath: string | null;
  remoteName: string | null;
  remoteUrl: string | null;
  remote: ForgeRemote | null;
  hasAccount: boolean;
  prs: PullRequestInfo[];
  loading: boolean;
  error: string | null;
  errorDetail: string | null;
  loadedAt: number | null;

  load: (force?: boolean) => Promise<void>;
  reset: () => void;
}

let requestSeq = 0;
const cache = new Map<string, ForgeSnapshot>();
const inFlight = new Set<string>();

function hostMatches(a: string, b: string): boolean {
  const strip = (host: string) => host.toLowerCase().split(':')[0];
  return strip(a) === strip(b);
}

function friendlyForgeError(raw: string, host: string): string {
  if (/error sending request|^request failed:|failed to read response/i.test(raw)) {
    return `Could not reach ${host} — check your network or VPN, then retry.`;
  }
  return raw;
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
  errorDetail: null,
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
      errorDetail: null,
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
    const key = `${path}|${origin.url}`;
    const remote = parseForgeRemote(origin.url);
    const provider = remote ? forgeProviderFor(path, remote) : null;

    if (!remote || !provider) {
      const snapshot: ForgeSnapshot = {
        remoteName: origin.name,
        remoteUrl: origin.url,
        remote: null,
        hasAccount: false,
        prs: [],
        error: null,
        errorDetail: null,
        loadedAt: null,
      };
      cache.set(key, snapshot);
      set({ repoPath: path, loading: false, ...snapshot });
      return;
    }

    const cached = cache.get(key);
    if (cached && (get().repoPath !== path || get().remoteUrl !== origin.url)) {
      set({ repoPath: path, loading: false, ...cached });
    }
    const fresh = cached?.loadedAt != null && Date.now() - cached.loadedAt < FRESH_MS;
    if (!force && (fresh || inFlight.has(key))) return;

    const token = ++requestSeq;
    inFlight.add(key);
    set({
      repoPath: path,
      remoteName: origin.name,
      remoteUrl: origin.url,
      remote,
      loading: true,
      ...(cached
        ? {}
        : { prs: [], hasAccount: false, error: null, errorDetail: null, loadedAt: null }),
    });

    const stillCurrent = () => token === requestSeq && useRepo.getState().repo?.path === path;
    const base = { remoteName: origin.name, remoteUrl: origin.url, remote };
    try {
      const accounts = await ipc.accountList();
      const hasAccount = accounts.some((account) => hostMatches(account.host, remote.host));
      let snapshot: ForgeSnapshot;
      if (!hasAccount) {
        snapshot = {
          ...base,
          hasAccount: false,
          prs: [],
          error: null,
          errorDetail: null,
          loadedAt: Date.now(),
        };
      } else {
        try {
          const prs = await provider.listOpenPullRequests();
          snapshot = {
            ...base,
            hasAccount: true,
            prs,
            error: null,
            errorDetail: null,
            loadedAt: Date.now(),
          };
        } catch (error) {
          const raw = (error as { message?: string }).message ?? String(error);
          snapshot = {
            ...base,
            hasAccount: true,
            prs: cached?.prs ?? [],
            error: friendlyForgeError(raw, remote.host),
            errorDetail: raw,
            loadedAt: Date.now(),
          };
        }
      }
      cache.set(key, snapshot);
      if (stillCurrent()) set({ loading: false, ...snapshot });
    } catch (error) {
      const raw = (error as { message?: string }).message ?? String(error);
      if (stillCurrent()) {
        set({
          loading: false,
          error: friendlyForgeError(raw, remote.host),
          errorDetail: raw,
          loadedAt: Date.now(),
        });
      }
    } finally {
      inFlight.delete(key);
    }
  },
}));
