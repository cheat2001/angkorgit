import { useMemo } from 'react';
import { toast } from 'sonner';
import { Copy, ShieldOff } from 'lucide-react';
import { cleanCliOutput } from '@angkorgit/core';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@angkorgit/design-system';

export type HookOperation = 'commit' | 'amend' | 'push';

export interface HookFailureView {
  operation: HookOperation;
  message: string;
  output: string;
}

const COPY: Record<HookOperation, { outcome: string; retry: string }> = {
  commit: {
    outcome: 'Nothing was committed. Your message is still in the commit box.',
    retry: 'Commit without hooks',
  },
  amend: {
    outcome: 'The last commit was not changed. Your message is still in the commit box.',
    retry: 'Amend without hooks',
  },
  push: {
    outcome: 'Nothing was pushed.',
    retry: 'Push without hooks',
  },
};

export function HookFailedDialog({
  failure,
  onRetry,
  onClose,
}: {
  failure: HookFailureView | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  const output = useMemo(() => cleanCliOutput(failure?.output ?? ''), [failure?.output]);
  const copy = () => {
    void navigator.clipboard.writeText(output).then(
      () => toast.success('Copied the hook output'),
      () => toast.error('Could not copy the hook output'),
    );
  };
  const text = COPY[failure?.operation ?? 'commit'];
  return (
    <Dialog open={failure !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-2xl" data-hook-failed={failure?.operation}>
        <DialogHeader>
          <DialogTitle>A hook stopped the {failure?.operation ?? 'commit'}</DialogTitle>
          <DialogDescription>
            {failure?.message} {text.outcome}
          </DialogDescription>
        </DialogHeader>
        {output ? (
          <pre
            data-hook-output
            className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-surface px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground [overflow-wrap:anywhere]"
          >
            {output}
          </pre>
        ) : (
          <p className="text-xs text-muted">The hook printed nothing.</p>
        )}
        <DialogFooter className="flex-wrap justify-between" data-hook-actions>
          <Button variant="ghost" onClick={copy} disabled={!output}>
            <Copy /> Copy output
          </Button>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={onRetry}>
              <ShieldOff /> {text.retry}
            </Button>
            <Button onClick={onClose} autoFocus>
              Close
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
