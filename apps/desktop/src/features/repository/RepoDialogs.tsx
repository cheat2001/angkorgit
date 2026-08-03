import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Textarea,
} from '@angkorgit/design-system';
import { ipc } from '@/core/ipc';
import { useRepo } from './store';
import { useUi } from '@/features/ui/store';

/** Small create/rename dialogs: branch, tag, stash, branch rename. */
export function RepoDialogs({ onDone }: { onDone: () => Promise<void> }) {
  const repo = useRepo((s) => s.repo);
  const { dialog, dialogContext, closeDialog } = useUi();
  const path = repo?.path ?? '';

  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [checkout, setCheckout] = useState(true);
  const [includeUntracked, setIncludeUntracked] = useState(true);

  useEffect(() => {
    setName(dialog === 'rename' ? (dialogContext ?? '') : '');
    setMessage('');
    setCheckout(true);
    setIncludeUntracked(true);
  }, [dialog, dialogContext]);

  const submit = async (label: string, op: () => Promise<unknown>) => {
    try {
      await op();
      toast.success(`${label} done`);
      closeDialog();
      await onDone();
    } catch (error) {
      toast.error(`${label} failed: ${(error as { message?: string }).message ?? error}`);
    }
  };

  return (
    <>
      <Dialog open={dialog === 'createBranch'} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create branch</DialogTitle>
            <DialogDescription>
              {dialogContext ? `From commit ${dialogContext.slice(0, 8)}` : 'From the current HEAD'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Input
              autoFocus
              placeholder="feature/my-branch"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && name.trim()) {
                  void submit('Create branch', () => ipc.createBranch(path, name.trim(), dialogContext, checkout));
                }
              }}
            />
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
              <Checkbox checked={checkout} onCheckedChange={(v) => setCheckout(v === true)} />
              Checkout after creating
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              disabled={!name.trim()}
              onClick={() => void submit('Create branch', () => ipc.createBranch(path, name.trim(), dialogContext, checkout))}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === 'createTag'} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create tag</DialogTitle>
            <DialogDescription>
              {dialogContext ? `At commit ${dialogContext.slice(0, 8)}` : 'At the current HEAD'} — add a message for an annotated tag.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Input autoFocus placeholder="v1.0.0" value={name} onChange={(e) => setName(e.target.value)} />
            <Textarea
              placeholder="Tag message (optional)"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              disabled={!name.trim()}
              onClick={() =>
                void submit('Create tag', () => ipc.tagCreate(path, name.trim(), dialogContext, message.trim() || null))
              }
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === 'createStash'} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stash changes</DialogTitle>
            <DialogDescription>Save your working changes and restore a clean tree.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Input
              autoFocus
              placeholder="Stash message (optional)"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
              <Checkbox checked={includeUntracked} onCheckedChange={(v) => setIncludeUntracked(v === true)} />
              Include untracked files
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                void submit('Stash', () => ipc.stashCreate(path, message.trim() || null, includeUntracked))
              }
            >
              Stash
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === 'rename'} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename branch</DialogTitle>
            <DialogDescription>Renaming “{dialogContext}”.</DialogDescription>
          </DialogHeader>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          <DialogFooter>
            <Button variant="ghost" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              disabled={!name.trim() || name.trim() === dialogContext}
              onClick={() =>
                void submit('Rename branch', () => ipc.renameBranch(path, dialogContext ?? '', name.trim()))
              }
            >
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
