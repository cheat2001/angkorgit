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

const useHookFailures = create<{ pending: Record<string, HookFailureReport> }>(() => ({ pending: {} }));

const ELSEWHERE: Record<HookOperation, (repo: string) => string> = {
  commit: (repo) => `Nothing was committed in ${repo}. The hook output is waiting there.`,
  amend: (repo) => `The last commit in ${repo} was not changed. The hook output is waiting there.`,
};

export function isHookFailure(error: unknown): error is IpcError {
  return typeof error === 'object' && error !== null && (error as Partial<IpcError>).code === 'hook_failed';
}

export function reportHookFailure(report: HookFailureReport): void {
  useHookFailures.setState((s) => ({ pending: { ...s.pending, [report.repoPath]: report } }));
  if (useRepo.getState().repo?.path !== report.repoPath) {
    toast.error(report.error.message || 'A hook stopped the operation.', {
      description: ELSEWHERE[report.operation](basename(report.repoPath)),
    });
  }
}

function dismiss(repoPath: string): void {
  useHookFailures.setState((s) => {
    const pending = { ...s.pending };
    delete pending[repoPath];
    return { pending };
  });
}

export function HookFailureHost() {
  const path = useRepo((s) => s.repo?.path ?? null);
  const report = useHookFailures((s) => (path ? (s.pending[path] ?? null) : null));
  return (
    <HookFailedDialog
      failure={report ? { operation: report.operation, message: report.error.message, output: report.error.detail ?? '' } : null}
      onClose={() => {
        if (report) dismiss(report.repoPath);
      }}
      onRetry={() => {
        if (!report) return;
        dismiss(report.repoPath);
        report.retry();
      }}
    />
  );
}
