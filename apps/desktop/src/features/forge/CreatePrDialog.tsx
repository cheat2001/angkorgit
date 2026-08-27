import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ArrowRight, GitPullRequest, Sparkles, Square } from 'lucide-react';
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
  Hint,
  Input,
  Logo,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Textarea,
} from '@angkorgit/design-system';
import { aiCapabilities } from '@angkorgit/core';
import { ipc, openExternal } from '@/core/ipc';
import { useRepo } from '@/features/repository/store';
import { useUi } from '@/features/ui/store';
import { aiConfigured, getAiProvider } from '@/features/ai/client';
import { forgeProviderFor, useForge } from './store';

function titleFromBranch(branch: string): string {
  const leaf = branch.split('/').pop() ?? branch;
  const words = leaf.replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : branch;
}

export function CreatePrDialog() {
  const repo = useRepo((s) => s.repo);
  const branches = useRepo((s) => s.branches);
  const dialog = useUi((s) => s.dialog);
  const closeDialog = useUi((s) => s.closeDialog);
  const remote = useForge((s) => s.remote);
  const remoteName = useForge((s) => s.remoteName);
  const open = dialog === 'createPullRequest';

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [base, setBase] = useState('');
  const [draft, setDraft] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const aiRun = useRef(0);

  const path = repo?.path ?? '';
  const source = repo?.headBranch ?? '';
  const provider = useMemo(
    () => (remote && path ? forgeProviderFor(path, remote) : null),
    [remote, path],
  );
  const noun = provider?.kind === 'gitlab' ? 'merge request' : 'pull request';

  const remotePrefix = `${remoteName ?? 'origin'}/`;
  const baseOptions = useMemo(() => {
    const names = branches
      .filter((b) => b.isRemote && b.name.startsWith(remotePrefix))
      .map((b) => b.name.slice(remotePrefix.length))
      .filter((name) => name && name !== source && name !== 'HEAD');
    return [...new Set(names)].sort();
  }, [branches, remotePrefix, source]);

  const head = branches.find((b) => !b.isRemote && b.isHead);
  const notPushed = !head?.upstream;
  const unpushed = head?.ahead ?? 0;

  useEffect(() => {
    if (!open) return;
    setTitle(titleFromBranch(source));
    setBody('');
    setDraft(false);
    setError(null);
    setSubmitting(false);
    setGenerating(false);
    aiRun.current += 1;
    setBase(
      baseOptions.includes('main') ? 'main' : baseOptions.includes('master') ? 'master' : baseOptions[0] ?? '',
    );
    let cancelled = false;
    void provider
      ?.defaultBranch()
      .then((name) => {
        if (!cancelled && baseOptions.includes(name)) setBase(name);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const generate = async () => {
    if (generating) {
      aiRun.current += 1;
      setGenerating(false);
      return;
    }
    const run = (aiRun.current += 1);
    setGenerating(true);
    try {
      let commitLines = '';
      const baseBranch =
        branches.find((b) => !b.isRemote && b.name === base) ??
        branches.find((b) => b.name === `${remotePrefix}${base}`);
      if (baseBranch) {
        try {
          const commits = await ipc.rebaseCommits(path, baseBranch.targetOid);
          commitLines = commits
            .map((c) => `${c.shortOid} ${c.summary}${c.body ? `\n${c.body}` : ''}`)
            .join('\n');
        } catch {
          commitLines = '';
        }
      }
      if (!commitLines) {
        const page = await ipc.history(path, { skip: 0, limit: 15, branch: source });
        commitLines = page.commits.map((c) => `${c.shortOid} ${c.summary}`).join('\n');
      }
      const text = await aiCapabilities.generatePrDescription(getAiProvider(), commitLines, '');
      if (run !== aiRun.current) return;
      setBody(text);
      setGenerating(false);
    } catch (err) {
      if (run !== aiRun.current) return;
      setGenerating(false);
      toast.error(`Could not generate a description: ${(err as { message?: string }).message ?? err}`);
    }
  };

  const submit = async () => {
    if (!provider || !title.trim() || !base || !source || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const pr = await provider.createPullRequest({
        title: title.trim(),
        body,
        sourceBranch: source,
        targetBranch: base,
        draft,
      });
      closeDialog();
      toast.success(`${provider.label} ${noun} #${pr.number} created`, {
        action: { label: 'Open', onClick: () => void openExternal(pr.url) },
      });
      void useForge.getState().load(true);
    } catch (err) {
      setError((err as { message?: string }).message ?? String(err));
      setSubmitting(false);
    }
  };

  if (!provider) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeDialog()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitPullRequest className="size-4 shrink-0 text-primary" />
            Create {noun}
          </DialogTitle>
          <DialogDescription>
            Opens a {noun} on {provider.label} for the current branch.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Badge tone="info" className="min-w-0 max-w-56">
              <span className="truncate">{source}</span>
            </Badge>
            <ArrowRight className="size-3.5 shrink-0 text-faint" />
            <Select value={base} onValueChange={setBase}>
              <SelectTrigger className="h-8 flex-1">
                <SelectValue placeholder="Target branch" />
              </SelectTrigger>
              <SelectContent>
                {baseOptions.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Input
            autoFocus
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="relative">
            <Textarea
              placeholder="Description (optional)"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="min-h-32 pr-9 font-mono text-xs"
            />
            {aiConfigured() && (
              <Hint label={generating ? 'Stop generating' : 'Generate a description with AI'}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="absolute right-1.5 top-1.5"
                  aria-label={generating ? 'Stop generating' : 'Generate description with AI'}
                  onClick={() => void generate()}
                >
                  {generating ? <Square className="size-3.5" /> : <Sparkles className="size-3.5" />}
                </Button>
              </Hint>
            )}
            {generating && (
              <span className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1.5 rounded bg-surface-overlay/90 px-1.5 py-0.5 text-[11px] text-muted">
                <Logo size={14} animated="loop" className="logo-draw-loop shrink-0" />
                Writing…
              </span>
            )}
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
            <Checkbox checked={draft} onCheckedChange={(v) => setDraft(v === true)} />
            Create as draft
          </label>
          {notPushed && (
            <p className="text-xs text-info">
              This branch has not been pushed yet — push it first so {provider.label} can see it.
            </p>
          )}
          {!notPushed && unpushed > 0 && (
            <p className="text-xs text-info">
              {unpushed} commit{unpushed === 1 ? '' : 's'} on this branch {unpushed === 1 ? 'is' : 'are'} not
              pushed yet and will not be part of the {noun}.
            </p>
          )}
          {error && <p className="text-xs text-danger [overflow-wrap:anywhere]">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={closeDialog}>
            Cancel
          </Button>
          <Button
            disabled={!title.trim() || !base || !source || notPushed || submitting}
            onClick={() => void submit()}
          >
            {submitting && <Spinner className="size-3.5" />}
            Create {noun}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
