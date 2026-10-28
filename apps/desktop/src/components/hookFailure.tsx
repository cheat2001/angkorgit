import { useEffect } from 'react';
import { create } from 'zustand';
import { toast } from 'sonner';
import type { IpcError } from '@/core/ipc';
import { useRepo } from '@/features/repository/store';
import { basename } from '@/shared/utils';
import { HookFailedDialog, type HookOperation } from './HookFailedDialog';

export interface HookFailureReport {
  repoPath: string;
  operation: HookOperation;
  error: IpcError;
  retry: () => void;
}

const useHookFailure = create<{ report: HookFailureReport | null }>(() => ({ report: null }));

const ELSEWHERE: Record<HookOperation, (repo: string) => string> = {
  commit: (repo) => `Nothing was committed in ${repo}. Commit there again to see the hook output.`,
  amend: (repo) => `The last commit in ${repo} was not changed. Amend there again to see the hook output.`,
  push: (repo) => `Nothing was pushed from ${repo}. Push there again to see the hook output.`,
};

export function isHookFailure(error: unknown): error is IpcError {
  return typeof error === 'object' && error !== null && (error as Partial<IpcError>).code === 'hook_failed';
}

export function reportHookFailure(report: HookFailureReport): void {
  if (useRepo.getState().repo?.path !== report.repoPath) {
    toast.error(report.error.message || 'A hook stopped the operation.', {
      description: ELSEWHERE[report.operation](basename(report.repoPath)),
    });
    return;
  }
  useHookFailure.setState({ report });
}

export function HookFailureHost() {
  const report = useHookFailure((s) => s.report);
  const path = useRepo((s) => s.repo?.path ?? null);
  useEffect(() => {
    if (report && report.repoPath !== path) useHookFailure.setState({ report: null });
  }, [report, path]);
  const shown = report && report.repoPath === path ? report : null;
  return (
    <HookFailedDialog
      failure={shown ? { operation: shown.operation, message: shown.error.message, output: shown.error.detail ?? '' } : null}
      onClose={() => useHookFailure.setState({ report: null })}
      onRetry={() => {
        const current = useHookFailure.getState().report;
        useHookFailure.setState({ report: null });
        current?.retry();
      }}
    />
  );
}
