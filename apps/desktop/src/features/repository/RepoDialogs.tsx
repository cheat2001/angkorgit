import { useEffect, useMemo, useRef, useState } from 'react';
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
import { ipc, type OpOutcome } from '@/core/ipc';
import { toastOutcome } from '@/shared/toastOutcome';
import { useRepo } from './store';
import { useUi } from '@/features/ui/store';
import { useUndo } from '@/features/history/undoStore';
import { useGraph } from '@/features/graph/store';
import { useSettings } from '@/features/settings/store';

export function RepoDialogs({ onDone }: { onDone: () => Promise<void> }) {
  const repo = useRepo((s) => s.repo);
  const { dialog, dialogContext: rawContext, closeDialog } = useUi();
  const dialogContext = typeof rawContext === 'string' ? rawContext : null;
  const path = repo?.path ?? '';
  const cherryPickRecordOrigin = useSettings((s) => s.cherryPickRecordOrigin);
  const setCherryPickRecordOrigin = useSettings((s) => s.setCherryPickRecordOrigin);
  const graphCommits = useGraph((s) => s.commits);
  const pickOids = useMemo(() => {
    if (dialog !== 'cherryPick' || !rawContext) return [];
    if (typeof rawContext === 'string') return [rawContext];
    return 'oids' in rawContext ? rawContext.oids : [];
  }, [dialog, rawContext]);
  const pickCommits = useMemo(
    () =>
      pickOids.map((oid) => ({
        oid,
        summary: graphCommits.find((c) => c.oid === oid)?.summary,
      })),
    [pickOids, graphCommits],
  );
  const cherryPickRef = useRef<HTMLButtonElement>(null);

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

  const submitCherryPick = () => {
    if (busy || pickOids.length === 0) return;
    const oids = pickOids;
    setBusy(true);
    void (async () => {
      try {
        const outcome = (await useUndo.getState().tracked({
          path,
          kind: 'cherryPick',
          label:
            oids.length === 1
              ? `Cherry-pick ${oids[0].slice(0, 8)}`
              : `Cherry-pick ${oids.length} commits`,
          action: () =>
            oids.length === 1
              ? ipc.cherryPick(path, oids[0], cherryPickRecordOrigin)
              : ipc.cherryPickMany(path, oids, cherryPickRecordOrigin),
          shouldRecord: (r) => (r as OpOutcome | undefined)?.status === 'ok',
        })) as OpOutcome | undefined;
        toastOutcome(outcome, 'Cherry-pick done');
        closeDialog();
        await onDone();
      } catch (error) {
        toast.error(`Cherry-pick failed: ${(error as { message?: string }).message ?? error}`);
      } finally {
        setBusy(false);
      }
    })();
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

      <Dialog open={dialog === 'cherryPick'} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            cherryPickRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {pickOids.length > 1 ? `Cherry-pick ${pickOids.length} commits` : 'Cherry-pick commit'}
            </DialogTitle>
            <DialogDescription>
              {pickOids.length > 1
                ? `Apply these commits, oldest first, as new commits on ${repo?.headBranch ?? 'the current branch'}.`
                : `Apply this commit as a new commit on ${repo?.headBranch ?? 'the current branch'}.`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border border-border-subtle bg-surface-raised px-2.5 py-2 text-xs">
              {pickCommits.map((commit) => (
                <div key={commit.oid} className="flex items-baseline gap-2">
                  <span className="shrink-0 font-mono text-muted">{commit.oid.slice(0, 8)}</span>
                  <span className="truncate text-foreground">{commit.summary}</span>
                </div>
              ))}
            </div>
            <label className="flex cursor-pointer items-start gap-2 text-xs text-muted">
              <Checkbox
                checked={cherryPickRecordOrigin}
                onCheckedChange={(v) => setCherryPickRecordOrigin(v === true)}
              />
              <span className="flex flex-col gap-0.5">
                <span>{pickOids.length > 1 ? 'Reference the source commits' : 'Reference the source commit'}</span>
                <span className="opacity-70">
                  Appends “(cherry picked from commit …)” to{' '}
                  {pickOids.length > 1 ? 'each new message' : 'the new message'}, like git
                  cherry-pick -x. Useful when backporting between shared branches.
                </span>
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={closeDialog}>
              Cancel
            </Button>
            <Button ref={cherryPickRef} disabled={busy} onClick={submitCherryPick}>
              {pickOids.length > 1 ? `Cherry-pick ${pickOids.length} commits` : 'Cherry-pick'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
