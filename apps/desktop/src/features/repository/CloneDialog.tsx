import { toastActionError } from '../../components/actionError';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, FolderOpen } from 'lucide-react';
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
import { ipc, listen, pickDirectory, type HostingAccount, type HostingAccountRef } from '@/core/ipc';
import { useUi, type ClonePreset, type DialogContext } from '@/features/ui/store';
import { useSettings } from '@/features/settings/store';
import { AccountRepositoryPicker } from './AccountRepositoryPicker';

const browsableProviders = new Set(['github', 'gitlab', 'gitlab-self', 'bitbucket']);

function clonePreset(ctx: DialogContext): ClonePreset | null {
  if (!ctx || typeof ctx === 'string' || !('url' in ctx) || !('into' in ctx)) return null;
  return ctx as ClonePreset;
}

export function CloneDialog({ onCloned }: { onCloned: (path: string) => void }) {
  const { dialog, dialogContext, closeDialog } = useUi();
  const cloneRoot = useSettings((s) => s.cloneRoot);
  const setCloneRoot = useSettings((s) => s.setCloneRoot);
  const open = dialog === 'clone';
  const [url, setUrl] = useState('');
  const [into, setInto] = useState('');
  const [branch, setBranch] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [accounts, setAccounts] = useState<HostingAccount[]>([]);
  const [pickedAccount, setPickedAccount] = useState<HostingAccountRef | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const urlInput = useRef<HTMLInputElement>(null);
  const browseButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      setAccounts([]);
      return;
    }
    let current = true;
    void ipc.accountList().then(
      (accounts) => {
        if (current) setAccounts(accounts.filter((account) => browsableProviders.has(account.provider)));
      },
      () => {
        if (current) setAccounts([]);
      },
    );
    return () => { current = false; };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setUrl('');
      setInto('');
      setBranch('');
      setProgress(null);
      setPickedAccount(null);
      setBrowsing(false);
      return;
    }
    const preset = clonePreset(dialogContext);
    if (preset) {
      setUrl(preset.url);
      setPickedAccount(null);
      setBrowsing(false);
      setInto(preset.into || cloneRoot || '');
      setBranch(preset.branch ?? '');
    } else if (cloneRoot) {
      setInto(cloneRoot);
    }
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void listen('clone-progress', (pct) => setProgress(pct as number)).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [open, dialogContext, cloneRoot]);

  const clone = async () => {
    if (progress !== null || !url.trim() || !into.trim()) return;
    setBrowsing(false);
    setProgress(0);
    try {
      const name = url.trim().replace(/\.git$/, '').split('/').pop() ?? 'repository';
      const target = `${into.replace(/\/$/, '')}/${name}`;
      const path = await ipc.cloneRepository(url.trim(), target, branch.trim() || null, pickedAccount);
      setCloneRoot(into.trim().replace(/\/$/, ''));
      toast.success('Repository cloned');
      closeDialog();
      onCloned(path);
    } catch (error) {
      toastActionError('Clone failed', error);
      setProgress(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeDialog()}>
      <DialogContent
        className="max-h-[calc(100vh-2rem)] overflow-y-auto"
        onEscapeKeyDown={(event) => {
          if (browsing) {
            event.preventDefault();
            setBrowsing(false);
            browseButton.current?.focus();
          }
        }}
      >
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
            ref={urlInput}
            aria-label="Repository URL"
            placeholder="git@github.com:user/repo.git"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setPickedAccount(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void clone();
            }}
          />
          {accounts.length > 0 && (
            <div className="flex flex-col items-stretch gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  ref={browseButton}
                  variant="secondary"
                  size="sm"
                  aria-expanded={browsing}
                  disabled={progress !== null}
                  onClick={() => setBrowsing((value) => !value)}
                >
                  Browse saved accounts
                  <ChevronDown className={browsing ? 'rotate-180' : undefined} />
                </Button>
                {pickedAccount && (
                  <span className="min-w-0 text-xs text-muted [overflow-wrap:anywhere]">
                    {pickedAccount.username} on {pickedAccount.host}
                  </span>
                )}
              </div>
              {browsing && (
                <AccountRepositoryPicker
                  accounts={accounts}
                  onSelect={(url, { host, username }) => {
                    setUrl(url);
                    setPickedAccount({ host, username });
                    setBrowsing(false);
                    urlInput.current?.focus();
                  }}
                />
              )}
            </div>
          )}
          <Input
            placeholder="Branch (optional)"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void clone();
            }}
          />
          <div className="flex gap-2">
            <Input
              placeholder="Destination folder"
              value={into}
              onChange={(e) => setInto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void clone();
              }}
            />
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
            <div className="flex flex-col gap-1">
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-raised">
                <div
                  className={`h-full rounded-full bg-primary transition-[width] duration-300 ${progress === 0 ? 'animate-pulse' : ''}`}
                  style={{ width: `${Math.max(4, progress)}%` }}
                />
              </div>
              <span className="text-xs text-muted">
                {progress === 0 ? 'Connecting…' : `Cloning… ${Math.round(progress)}%`}
              </span>
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
