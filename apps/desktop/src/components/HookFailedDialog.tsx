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

export interface CommitRequest {
  repoPath: string;
  message: string;
  amend: boolean;
}

export interface HookFailure {
  request: CommitRequest;
  message: string;
  output: string;
}

export function HookFailedDialog({
  failure,
  onCommitWithoutHooks,
  onClose,
}: {
  failure: HookFailure | null;
  onCommitWithoutHooks: () => void;
  onClose: () => void;
}) {
  const output = useMemo(() => cleanCliOutput(failure?.output ?? ''), [failure]);
  const copy = () => {
    void navigator.clipboard.writeText(output).then(
      () => toast.success('Copied the hook output'),
      () => toast.error('Could not copy the hook output'),
    );
  };
  return (
    <Dialog open={failure !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-2xl" data-hook-failed>
        <DialogHeader>
          <DialogTitle>A hook stopped the {failure?.request.amend ? 'amend' : 'commit'}</DialogTitle>
          <DialogDescription>
            {failure?.message}{' '}
            {failure?.request.amend ? 'The last commit was not changed.' : 'Nothing was committed.'} Your
            message is still in the commit box.
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
            <Button variant="outline" onClick={onCommitWithoutHooks}>
              <ShieldOff /> {failure?.request.amend ? 'Amend' : 'Commit'} without hooks
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
