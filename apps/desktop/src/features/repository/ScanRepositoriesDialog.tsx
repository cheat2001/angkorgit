import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FolderGit2, FolderSearch, FolderTree } from 'lucide-react';
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
  cn,
} from '@angkorgit/design-system';
import type { RepositoryScan, ScannedRepository } from '@angkorgit/core';
import { ipc, pickDirectory } from '@/core/ipc';
import { useUi, type DialogContext, type ScanRepositoriesPreset } from '@/features/ui/store';
import { DirName } from '@/components/DirName';
import { SettingEmpty } from '@/features/settings/SettingCard';
import { shortenHome } from '@/shared/utils';
import { useRepo } from './store';

function scanPreset(ctx: DialogContext): ScanRepositoriesPreset | null {
  if (!ctx || typeof ctx === 'string' || !('scanRoot' in ctx)) return null;
  return ctx as ScanRepositoriesPreset;
}

const normalized = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '');

function relativeTo(root: string, path: string): string {
  const base = normalized(root);
  const target = normalized(path);
  if (target === base) return '';
  return target.startsWith(`${base}/`) ? target.slice(base.length + 1) : shortenHome(path);
}

export async function startRepositoryScan() {
  const dir = await pickDirectory('Choose a folder to scan for repositories');
  if (dir) useUi.getState().openDialog('scanRepositories', { scanRoot: dir });
}

export function ScanRepositoriesDialog() {
  const { dialog, dialogContext, closeDialog } = useUi();
  const recents = useRepo((s) => s.recents);
  const loadRecents = useRepo((s) => s.loadRecents);
  const open = dialog === 'scanRepositories';
  const [root, setRoot] = useState('');
  const [scan, setScan] = useState<RepositoryScan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const seq = useRef(0);

  const known = useMemo(() => new Set(recents.map((r) => normalized(r.path))), [recents]);
  const isKnown = (repo: ScannedRepository) => known.has(normalized(repo.path));

  useEffect(() => {
    if (!open) {
      seq.current++;
      setRoot('');
      setScan(null);
      setError(null);
      setSelected(new Set());
      setAdding(false);
      return;
    }
    const preset = scanPreset(dialogContext);
    if (preset) setRoot(preset.scanRoot);
  }, [open, dialogContext]);

  useEffect(() => {
    if (!open || !root) return;
    const token = ++seq.current;
    setScan(null);
    setError(null);
    void ipc
      .scanRepositories(root)
      .then((result) => {
        if (token !== seq.current) return;
        const current = new Set(useRepo.getState().recents.map((r) => normalized(r.path)));
        setScan(result);
        setSelected(
          new Set(result.repositories.filter((r) => !current.has(normalized(r.path))).map((r) => r.path)),
        );
      })
      .catch((e) => {
        if (token !== seq.current) return;
        setError((e as { message?: string }).message ?? String(e));
      });
  }, [open, root]);

  const found = scan?.repositories ?? [];
  const fresh = found.filter((r) => !isKnown(r));
  const allPicked = fresh.length > 0 && fresh.every((r) => selected.has(r.path));

  const toggle = (path: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const changeRoot = async () => {
    const dir = await pickDirectory('Choose a folder to scan for repositories');
    if (dir) setRoot(dir);
  };

  const add = async () => {
    const paths = found.filter((r) => selected.has(r.path) && !isKnown(r)).map((r) => r.path);
    if (paths.length === 0 || adding) return;
    setAdding(true);
    try {
      await ipc.addRecents(paths);
      await loadRecents();
      toast.success(paths.length === 1 ? 'Added 1 repository' : `Added ${paths.length} repositories`);
      closeDialog();
    } catch (e) {
      toast.error(`Could not add repositories: ${(e as { message?: string }).message ?? e}`);
      setAdding(false);
    }
  };

  const pickedCount = fresh.filter((r) => selected.has(r.path)).length;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeDialog()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add repositories from a folder</DialogTitle>
          <DialogDescription>
            Looks through every folder, including inside other repositories, and skips hidden and
            dependency folders such as node_modules.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface-raised/50 px-3 py-2">
          <FolderSearch className="size-4 shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground" title={root} data-scan-root>
            {shortenHome(root)}
          </span>
          <Button variant="secondary" size="sm" onClick={() => void changeRoot()} disabled={adding}>
            Change…
          </Button>
        </div>

        {error ? (
          <p className="text-sm text-danger [overflow-wrap:anywhere]">{error}</p>
        ) : !scan ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted" data-scan-busy>
            <Spinner className="size-4 text-primary" /> Scanning…
          </div>
        ) : found.length === 0 ? (
          <SettingEmpty
            icon={<FolderGit2 className="size-4" />}
            title="No repositories found"
            description="Nothing in this folder has a .git directory. Try a folder higher up, or pick another one."
          />
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-xs text-muted">
              <span data-scan-summary>
                Found {found.length}
                {scan.truncated ? '+' : ''}
                {found.length - fresh.length > 0 && ` · ${found.length - fresh.length} already in recents`}
              </span>
              {fresh.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-6 px-2 text-xs"
                  onClick={() => setSelected(allPicked ? new Set() : new Set(fresh.map((r) => r.path)))}
                >
                  {allPicked ? 'Select none' : 'Select all'}
                </Button>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto rounded-md border border-border-subtle p-1" data-scan-results>
              {found.map((repo) => {
                const already = isKnown(repo);
                const rel = relativeTo(root, repo.path);
                return (
                  <label
                    key={repo.path}
                    className={cn(
                      'flex items-center gap-3 rounded px-2 py-1.5',
                      already ? 'cursor-default opacity-60' : 'cursor-pointer hover:bg-surface-raised',
                    )}
                    title={repo.path}
                  >
                    <Checkbox
                      checked={already || selected.has(repo.path)}
                      disabled={already}
                      onCheckedChange={() => toggle(repo.path)}
                      aria-label={`Add ${repo.name}`}
                    />
                    <span className="flex size-6 shrink-0 items-center justify-center rounded bg-primary/10 text-primary">
                      {repo.isWorktree ? <FolderTree className="size-3.5" /> : <FolderGit2 className="size-3.5" />}
                    </span>
                    <span className="max-w-full shrink-0 truncate text-sm font-medium text-foreground">{repo.name}</span>
                    <DirName path={rel} className="font-mono text-[11px]" />
                    {already && (
                      <Badge className="ml-auto shrink-0">
                        In recents
                      </Badge>
                    )}
                  </label>
                );
              })}
            </div>
            {scan.truncated && (
              <p className="text-xs text-muted">
                The scan stopped at {found.length} repositories. Pick a narrower folder to see the rest.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={closeDialog}>
            Cancel
          </Button>
          <Button autoFocus onClick={() => void add()} disabled={pickedCount === 0 || adding}>
            {adding ? <Spinner className="text-primary-foreground" /> : null}
            {pickedCount === 1 ? 'Add 1 repository' : `Add ${pickedCount} repositories`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
