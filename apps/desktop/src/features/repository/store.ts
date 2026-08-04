import { create } from 'zustand';
import type {
  BranchInfo,
  RecentRepository,
  RemoteInfo,
  RepositoryInfo,
  StashInfo,
  StatusSummary,
  SubmoduleInfo,
  TagInfo,
} from '@angkorgit/core';
import { ipc } from '@/core/ipc';

interface RepoState {
  repo: RepositoryInfo | null;
  status: StatusSummary | null;
  branches: BranchInfo[];
  tags: TagInfo[];
  stashes: StashInfo[];
  remotes: RemoteInfo[];
  submodules: SubmoduleInfo[];
  conflicts: string[];
  recents: RecentRepository[];
  busy: string | null;

  loadRecents: () => Promise<void>;
  open: (path: string) => Promise<RepositoryInfo>;
  close: () => void;
  refresh: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  setBusy: (label: string | null) => void;
}

export const useRepo = create<RepoState>((set, get) => ({
  repo: null,
  status: null,
  branches: [],
  tags: [],
  stashes: [],
  remotes: [],
  submodules: [],
  conflicts: [],
  recents: [],
  busy: null,

  loadRecents: async () => {
    const recents = await ipc.recentRepositories();
    set({ recents });
  },

  open: async (path: string) => {
    const repo = await ipc.openRepository(path);
    set({ repo });
    void import('@/features/ui/store').then(({ useUi }) =>
      useUi.getState().addRepoTab(repo.path),
    );
    await get().refresh();
    void get().loadRecents();
    return repo;
  },

  close: () =>
    set({
      repo: null,
      status: null,
      branches: [],
      tags: [],
      stashes: [],
      remotes: [],
      submodules: [],
      conflicts: [],
    }),

  refresh: async () => {
    const { repo } = get();
    if (!repo) return;
    const path = repo.path;
    const [info, status, branches, tags, stashes, remotes, submodules, conflicts] =
      await Promise.all([
        ipc.repoInfo(path),
        ipc.status(path),
        ipc.branches(path),
        ipc.tags(path),
        ipc.stashes(path),
        ipc.remotes(path),
        ipc.submodules(path),
        ipc.conflicts(path),
      ]);
    set({ repo: info, status, branches, tags, stashes, remotes, submodules, conflicts });
  },

  refreshStatus: async () => {
    const { repo } = get();
    if (!repo) return;
    const [status, conflicts] = await Promise.all([
      ipc.status(repo.path),
      ipc.conflicts(repo.path),
    ]);
    set({ status, conflicts });
  },

  setBusy: (busy) => set({ busy }),
}));
