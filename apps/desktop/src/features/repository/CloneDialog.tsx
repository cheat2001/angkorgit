import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FolderOpen } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Spinner,
} from '@angkorgit/design-system';
import { ipc, listen, pickDirectory } from '@/core/ipc';
import { useUi } from '@/features/ui/store';

export function CloneDialog({ onCloned }: { onCloned: (path: string) => void }) {
  const { dialog, closeDialog } = useUi();
  const open = dialog === 'clone';
  const [url, setUrl] = useState('');
  const [into, setInto] = useState('');
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    if (!open) {
      setProgress(null);
      return;
    }
    let unlisten: (() => void) | undefined;
    void listen('clone-progress', (pct) => setProgress(pct as number)).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [open]);

  const clone = async () => {
    if (!url.trim() || !into.trim()) return;
    setProgress(0);
    try {
      const name = url.trim().replace(/\.git$/, '').split('/').pop() ?? 'repository';
      const target = `${into.replace(/\/$/, '')}/${name}`;
      const path = await ipc.cloneRepository(url.trim(), target);
      toast.success('Repository cloned');
      closeDialog();
      onCloned(path);
    } catch (error) {
      toast.error(`Clone failed: ${(error as { message?: string }).message ?? error}`);
      setProgress(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeDialog()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Clone repository</DialogTitle>
          <DialogDescription>
            HTTPS or SSH URL. HTTPS uses your saved accounts first, then the system credential
            helper; SSH uses your agent and keys.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input
            autoFocus
            placeholder="git@github.com:user/repo.git"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <div className="flex gap-2">
            <Input placeholder="Destination folder" value={into} onChange={(e) => setInto(e.target.value)} />
            <Button
              variant="secondary"
              size="icon"
              aria-label="Browse destination"
              onClick={async () => {
                const dir = await pickDirectory('Choose destination folder');
                if (dir) setInto(dir);
              }}
            >
              <FolderOpen />
            </Button>
          </div>
          {progress !== null && (
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-raised">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${Math.max(4, progress)}%` }}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={closeDialog}>
            Cancel
          </Button>
          <Button onClick={() => void clone()} disabled={progress !== null || !url.trim() || !into.trim()}>
            {progress !== null ? <Spinner className="text-primary-foreground" /> : null}
            Clone
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
