import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface CommitDraftState {
  drafts: Record<string, string>;
  amendFor: string | null;
  setDraft: (path: string, message: string) => void;
  clearDraft: (path: string) => void;
  setAmend: (path: string, amend: boolean) => void;
}

export const useCommitDraft = create<CommitDraftState>()(
  persist(
    (set) => ({
      drafts: {},
      amendFor: null,
      setDraft: (path, message) =>
        set((s) => {
          const drafts = { ...s.drafts };
          if (message) drafts[path] = message;
          else delete drafts[path];
          return { drafts };
        }),
      clearDraft: (path) =>
        set((s) => {
          if (!(path in s.drafts)) return s;
          const drafts = { ...s.drafts };
          delete drafts[path];
          return { drafts };
        }),
      setAmend: (path, amend) => set({ amendFor: amend ? path : null }),
    }),
    {
      name: 'angkorgit-commit-drafts',
      partialize: (s) => ({ drafts: s.drafts }),
    },
  ),
);
