import { useEffect } from 'react';
import { create } from 'zustand';
import { toast } from 'sonner';
import type { HookWarningEvent } from '@angkorgit/core';
import { listen } from '@/core/ipc';
import { basename } from '@/shared/utils';
import { HookWarningDialog } from './HookFailedDialog';

const useHookWarnings = create<{ open: HookWarningEvent | null }>(() => ({ open: null }));

const AFTER_OPERATION_TOAST_MS = 600;

export function reportHookWarning(warning: HookWarningEvent): void {
  window.setTimeout(() => showHookWarning(warning), AFTER_OPERATION_TOAST_MS);
}

function showHookWarning(warning: HookWarningEvent): void {
  const repoName = basename(warning.repoPath);
  if (warning.status === null && !warning.timedOut) {
    toast.warning(`The ${warning.hook} hook did not run`, { description: warning.message, duration: 12000 });
    return;
  }
  toast.warning(warning.timedOut ? `The ${warning.hook} hook timed out` : warning.message, {
    description: warning.timedOut
      ? `It was stopped. Nothing was undone in ${repoName}; what it changed before stays.`
      : `Nothing was undone in ${repoName}.`,
    duration: 12000,
    action: warning.output
      ? { label: 'Show output', onClick: () => useHookWarnings.setState({ open: warning }) }
      : undefined,
  });
}

export function HookWarningHost() {
  const open = useHookWarnings((s) => s.open);
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void listen('hook-warning', (payload) => reportHookWarning(payload as HookWarningEvent)).then((stop) => {
      if (cancelled) stop();
      else unlisten = stop;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
  return (
    <HookWarningDialog
      warning={
        open
          ? { hook: open.hook, timedOut: open.timedOut, message: open.message, output: open.output, repoName: basename(open.repoPath) }
          : null
      }
      onClose={() => useHookWarnings.setState({ open: null })}
    />
  );
}
