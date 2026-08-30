import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ArrowRight, GitPullRequest, Sparkles, Square, Users } from 'lucide-react';
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
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
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
import { aiCapabilities, forgeNoun, type ForgeUser } from '@angkorgit/core';
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

interface DialogMeta {
  defaultBranch: string | null;
  users: ForgeUser[] | null;
}

const dialogMetaCache = new Map<string, DialogMeta>();

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
  const [candidates, setCandidates] = useState<ForgeUser[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [reviewers, setReviewers] = useState<string[]>([]);
  const [defaultBranchName, setDefaultBranchName] = useState<string | null>(null);
  const [accountUsername, setAccountUsername] = useState<string | null>(null);
  const [accountLookupFailed, setAccountLookupFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const aiRun = useRef(0);
  const baseTouched = useRef(false);

  const path = repo?.path ?? '';
  const source = repo?.headBranch ?? '';
  const provider = useMemo(
    () => (remote && path ? forgeProviderFor(path, remote) : null),
    [remote, path],
  );
  const noun = forgeNoun(provider?.kind);

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
    baseTouched.current = false;
    setBase('');
    setReviewers([]);

    const key = remote ? `${path}|${remote.webUrl}` : '';
    const cached = key ? dialogMetaCache.get(key) : undefined;
    setDefaultBranchName(cached?.defaultBranch ?? null);
    setCandidates(cached?.users ?? []);
    setCandidatesLoading(!cached?.users);

    setAccountLookupFailed(false);
    let cancelled = false;
    void ipc
      .accountList()
      .then((accounts) => {
        const match = accounts.find(
          (account) => remote && account.host.toLowerCase().split(':')[0] === remote.host.toLowerCase().split(':')[0],
        );
        if (!cancelled) setAccountUsername(match?.username ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setAccountUsername(null);
          setAccountLookupFailed(true);
        }
      });
    if (!provider || !key) return;
    const meta: DialogMeta = cached ? { ...cached } : { defaultBranch: null, users: null };
    if (meta.defaultBranch === null) {
      void provider
        .defaultBranch()
        .then((name) => {
          meta.defaultBranch = name;
          dialogMetaCache.set(key, { ...meta });
          if (!cancelled) setDefaultBranchName(name);
        })
        .catch(() => {});
    }
    if (meta.users === null) {
      void provider
        .listReviewerCandidates()
        .then((users) => {
          meta.users = users;
          dialogMetaCache.set(key, { ...meta });
          if (!cancelled) setCandidates(users);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setCandidatesLoading(false);
        });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || baseTouched.current || baseOptions.length === 0) return;
    const preferred =
      defaultBranchName && baseOptions.includes(defaultBranchName)
        ? defaultBranchName
        : baseOptions.includes('main')
          ? 'main'
          : baseOptions.includes('master')
            ? 'master'
            : baseOptions[0];
    if (preferred !== base) setBase(preferred);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, baseOptions, defaultBranchName]);

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

  const visibleCandidates = useMemo(
    () =>
      accountUsername
        ? candidates.filter((user) => user.username.toLowerCase() !== accountUsername.toLowerCase())
        : candidates,
    [candidates, accountUsername],
  );

  const submit = async () => {
    if (!provider || !title.trim() || !base || !source || notPushed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const pr = await provider.createPullRequest({
        title: title.trim(),
        body,
        sourceBranch: source,
        targetBranch: base,
        draft,
        reviewerIds: reviewers,
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
            <Select
              value={base}
              onValueChange={(value) => {
                baseTouched.current = true;
                setBase(value);
              }}
            >
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
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
          />
          <div className="relative">
            <Textarea
              placeholder="Description (optional)"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit();
              }}
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
          <div className="flex min-w-0 items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm" className="shrink-0">
                  <Users className="size-3.5" />
                  {reviewers.length > 0
                    ? `${reviewers.length} reviewer${reviewers.length === 1 ? '' : 's'}`
                    : 'Add reviewers'}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-64 w-72 overflow-y-auto">
                {candidatesLoading && (
                  <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-faint">
                    <Logo size={14} animated="loop" className="logo-draw-loop shrink-0" />
                    Loading members…
                  </div>
                )}
                {accountLookupFailed && (
                  <div className="px-2 py-1.5 text-xs text-faint">
                    Could not identify your account — add reviewers on {provider.label} instead.
                  </div>
                )}
                {!candidatesLoading && !accountLookupFailed && visibleCandidates.length === 0 && (
                  <div className="px-2 py-1.5 text-xs text-faint">
                    No members found — reviewers can still be added on {provider.label}.
                  </div>
                )}
                {!accountLookupFailed && visibleCandidates.map((user) => (
                  <DropdownMenuCheckboxItem
                    key={user.id}
                    checked={reviewers.includes(user.id)}
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={(checked) =>
                      setReviewers((prev) =>
                        checked === true ? [...prev, user.id] : prev.filter((id) => id !== user.id),
                      )
                    }
                  >
                    {user.avatarUrl && (
                      <img src={user.avatarUrl} alt="" className="mr-1.5 size-4 shrink-0 rounded-full" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{user.name}</span>
                    {user.username && user.username !== user.name && (
                      <span className="ml-2 shrink-0 text-xs text-faint">@{user.username}</span>
                    )}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <span className="min-w-0 flex-1 truncate text-xs text-muted">
              {reviewers.length > 0
                ? candidates
                    .filter((user) => reviewers.includes(user.id))
                    .map((user) => user.name)
                    .join(', ')
                : 'Optional'}
            </span>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
            <Checkbox checked={draft} onCheckedChange={(v) => setDraft(v === true)} />
            Create as draft
          </label>
          {baseOptions.length === 0 && (
            <p className="text-xs text-info">
              No remote branches found — fetch first so the target branch list can fill in.
            </p>
          )}
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
