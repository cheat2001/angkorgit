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

let openSeq = 0;
let fullSeq = 0;
let statusSeq = 0;

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
    const seq = ++openSeq;
    const repo = await ipc.openRepository(path);
    if (seq !== openSeq) return repo;
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
    const seq = ++fullSeq;
    const statusEpoch = ++statusSeq;
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
    if (get().repo?.path !== path || seq !== fullSeq) return;
    if (statusEpoch === statusSeq) {
      set({ repo: info, status, branches, tags, stashes, remotes, submodules, conflicts });
    } else {
      set({ repo: info, branches, tags, stashes, remotes, submodules });
    }
  },

  refreshStatus: async () => {
    const { repo } = get();
    if (!repo) return;
    const path = repo.path;
    const statusEpoch = ++statusSeq;
    const [status, conflicts] = await Promise.all([ipc.status(path), ipc.conflicts(path)]);
    if (get().repo?.path !== path || statusEpoch !== statusSeq) return;
    set({ status, conflicts });
  },

  setBusy: (busy) => set({ busy }),
}));
