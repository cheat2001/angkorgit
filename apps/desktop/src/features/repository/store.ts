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
  WorktreeInfo,
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
  worktrees: WorktreeInfo[];
  conflicts: string[];
  recents: RecentRepository[];
  busy: string | null;
  opening: string | null;
  refreshing: boolean;
  profileId: string | null;

  loadRecents: () => Promise<void>;
  open: (path: string) => Promise<RepositoryInfo>;
  close: () => void;
  refresh: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  setBusy: (label: string | null) => void;
  setProfileId: (profileId: string | null) => void;
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
  worktrees: [],
  conflicts: [],
  recents: [],
  busy: null,
  opening: null,
  refreshing: false,
  profileId: null,

  loadRecents: async () => {
    const recents = await ipc.recentRepositories();
    set({ recents });
  },

  open: async (path: string) => {
    const seq = ++openSeq;
    const previousPath = get().repo?.path;
    set({ opening: path });
    let repo: RepositoryInfo;
    try {
      repo = await ipc.openRepository(path);
    } catch (error) {
      if (seq === openSeq) set({ opening: null });
      throw error;
    }
    if (seq !== openSeq) return repo;
    if (previousPath !== undefined && previousPath !== repo.path) {
      set({
        repo,
        profileId: null,
        opening: null,
        refreshing: true,
        status: null,
        branches: [],
        tags: [],
        stashes: [],
        remotes: [],
        submodules: [],
        worktrees: [],
        conflicts: [],
      });
    } else {
      set({ repo, profileId: null, opening: null, refreshing: true });
    }
    void ipc
      .configGet(repo.path, 'angkorgit.profile')
      .then((profileId) => {
        if (seq === openSeq && get().repo?.path === repo.path) set({ profileId });
      })
      .catch(() => undefined);
    void import('@/features/ui/store').then(({ useUi }) => {
      useUi.getState().addRepoTab(repo.path);
      useUi.getState().markWorktreeTab(repo.path, repo.isWorktree);
    });
    try {
      await get().refresh();
    } finally {
      if (seq === openSeq) set({ refreshing: false });
    }
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
      worktrees: [],
      conflicts: [],
      opening: null,
      refreshing: false,
      profileId: null,
    }),

  refresh: async () => {
    const { repo } = get();
    if (!repo) return;
    const path = repo.path;
    const seq = ++fullSeq;
    const statusEpoch = ++statusSeq;
    const [info, status, branches, tags, stashes, remotes, submodules, conflicts, worktrees] =
      await Promise.all([
        ipc.repoInfo(path),
        ipc.status(path),
        ipc.branches(path),
        ipc.tags(path),
        ipc.stashes(path),
        ipc.remotes(path),
        ipc.submodules(path),
        ipc.conflicts(path),
        ipc.worktrees(path).catch(() => [] as WorktreeInfo[]),
      ]);
    if (get().repo?.path !== path || seq !== fullSeq) return;
    if (statusEpoch === statusSeq) {
      set({ repo: info, status, branches, tags, stashes, remotes, submodules, worktrees, conflicts });
    } else {
      set({ repo: info, branches, tags, stashes, remotes, submodules, worktrees });
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
  setProfileId: (profileId) => set({ profileId }),
}));
