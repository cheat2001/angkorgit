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
import { useUndo } from '@/features/history/undoStore';

export function RepoDialogs({ onDone }: { onDone: () => Promise<void> }) {
  const repo = useRepo((s) => s.repo);
  const { dialog, dialogContext: rawContext, closeDialog } = useUi();
  const dialogContext = typeof rawContext === 'string' ? rawContext : null;
  const path = repo?.path ?? '';

  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [checkout, setCheckout] = useState(true);
  const [includeUntracked, setIncludeUntracked] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(dialog === 'rename' ? (dialogContext ?? '') : '');
    setMessage('');
    setCheckout(true);
    setIncludeUntracked(true);
    setBusy(false);
  }, [dialog, dialogContext]);

  const submit = async (label: string, op: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await op();
      toast.success(`${label} done`);
      closeDialog();
      await onDone();
    } catch (error) {
      toast.error(`${label} failed: ${(error as { message?: string }).message ?? error}`);
    } finally {
      setBusy(false);
    }
  };

  const submitCreateBranch = () => {
    if (!name.trim()) return;
    void submit('Create branch', () =>
      useUndo.getState().tracked({
        path,
        kind: 'branchCreate',
        label: `create branch ${name.trim()}`,
        extra: { branch: name.trim(), oid: dialogContext ?? (repo?.headOid ?? '') },
        action: () => ipc.createBranch(path, name.trim(), dialogContext, checkout),
      }),
    );
  };

  const submitCreateTag = () => {
    if (!name.trim()) return;
    void submit('Create tag', () =>
      ipc.tagCreate(path, name.trim(), dialogContext, message.trim() || null),
    );
  };

  const submitStash = () => {
    void submit('Stash', () => ipc.stashCreate(path, message.trim() || null, includeUntracked));
  };

  const submitRename = () => {
    if (!name.trim() || name.trim() === dialogContext) return;
    void submit('Rename branch', () =>
      useUndo.getState().tracked({
        path,
        kind: 'branchRename',
        label: `rename ${dialogContext} → ${name.trim()}`,
        extra: { from: dialogContext ?? '', to: name.trim() },
        action: () => ipc.renameBranch(path, dialogContext ?? '', name.trim()),
      }),
    );
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
                if (e.key === 'Enter') submitCreateBranch();
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
            <Button disabled={busy || !name.trim()} onClick={submitCreateBranch}>
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
            <Input
              autoFocus
              placeholder="v1.0.0"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitCreateTag();
              }}
            />
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
            <Button disabled={busy || !name.trim()} onClick={submitCreateTag}>
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
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitStash();
              }}
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
            <Button disabled={busy} onClick={submitStash}>
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
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitRename();
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              disabled={busy || !name.trim() || name.trim() === dialogContext}
              onClick={submitRename}
            >
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
