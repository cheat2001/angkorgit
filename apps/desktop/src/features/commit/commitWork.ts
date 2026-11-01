import { create } from 'zustand';
import { toast } from 'sonner';
import { ipc, type CommitOutcome } from '@/core/ipc';
import { isHookFailure, reportHookFailure } from '@/components/hookFailure';
import { useRepo } from '@/features/repository/store';
import { useGraph } from '@/features/graph/store';
import { useUndo } from '@/features/history/undoStore';
import { useAiWork } from '@/features/ai/workStore';
import { ensureRepoProfile } from '@/features/settings/profiles';
import { basename } from '@/shared/utils';
import { useCommitDraft } from './draftStore';

export interface CommitRequest {
  repoPath: string;
  message: string;
  amend: boolean;
}

interface RunningCommit {
  hooks: boolean;
}

interface CommitWorkState {
  running: Record<string, RunningCommit>;
  skipHooks: Record<string, boolean>;
  setSkipHooks: (repoPath: string, skip: boolean) => void;
}

export const useCommitWork = create<CommitWorkState>((set) => ({
  running: {},
  skipHooks: {},
  setSkipHooks: (repoPath, skip) => set((s) => ({ skipHooks: { ...s.skipHooks, [repoPath]: skip } })),
}));

function reportOutcome(outcome: CommitOutcome, done: string): void {
  if (outcome.hookWarning) {
    toast.warning(`${done} without running hooks`, { description: outcome.hookWarning, duration: 12000 });
  } else {
    toast.success(done);
  }
}

export async function runCommit(request: CommitRequest, noVerify: boolean, hooksPresent: boolean): Promise<void> {
  const target = request.repoPath;
  if (useCommitWork.getState().running[target]) return;
  useCommitWork.setState((s) => ({ running: { ...s.running, [target]: { hooks: hooksPresent && !noVerify } } }));
  const isCurrent = () => useRepo.getState().repo?.path === target;
  const where = () => (isCurrent() ? '' : ` in ${basename(target)}`);
  const text = request.message.trim();
  try {
    await ensureRepoProfile(target);
    if (request.amend) {
      reportOutcome(await ipc.amend(target, text ? text : null, noVerify), `Commit amended${where()}`);
    } else {
      const summary = text.split('\n')[0].slice(0, 50);
      const outcome = await useUndo.getState().tracked({
        path: target,
        kind: 'commit',
        label: `commit "${summary}"`,
        action: () => ipc.commit(target, text, noVerify),
      });
      reportOutcome(outcome, `Committed${where()}`);
    }
    const drafts = useCommitDraft.getState();
    if ((drafts.drafts[target] ?? '') === request.message) drafts.setDraft(target, '');
    if (drafts.amendFor === target) drafts.setAmend(target, false);
    useAiWork.getState().setReview(target, null);
    useCommitWork.getState().setSkipHooks(target, false);
    if (isCurrent()) await useRepo.getState().refreshStatus();
    if (isCurrent()) await useGraph.getState().reload(target);
  } catch (error) {
    if (isHookFailure(error)) {
      reportHookFailure({
        repoPath: target,
        operation: request.amend ? 'amend' : 'commit',
        error,
        retry: () => void runCommit(request, true, hooksPresent),
      });
    } else {
      toast.error(`Commit failed${where()}: ${(error as { message?: string } | null)?.message ?? error}`);
    }
  } finally {
    useCommitWork.setState((s) => {
      const running = { ...s.running };
      delete running[target];
      return { running };
    });
  }
}
