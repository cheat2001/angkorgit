import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Check,
  ChevronDown,
  Copy,
  FolderOpen,
  Github,
  Keyboard,
  KeyRound,
  Minus,
  Moon,
  MoreHorizontal,
  Palette,
  Plus,
  RefreshCw,
  Sparkles,
  SquareTerminal,
  Sun,
  Trash2,
  User,
  UserRound,
  UsersRound,
  Wifi,
} from 'lucide-react';
import {
  AI_PROVIDER_PRESETS,
  COMMIT_STYLE_PRESETS,
  PROJECT_REVIEW_FILE,
  listAiModels,
  resolveCommitPrefix,
  type AiProviderKind,
  type CliAgentInfo,
  type CommitStylePreset,
} from '@angkorgit/core';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Hint,
  Input,
  Kbd,
  Logo,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Spinner,
  Switch,
  Textarea,
  cn,
} from '@angkorgit/design-system';
import { ipc, pickFile, type HostingAccount } from '@/core/ipc';
import { Avatar } from '@/components/Avatar';
import { confirmDialog } from '@/components/confirm';
import { useRepo } from '@/features/repository/store';
import { useUi } from '@/features/ui/store';
import { ACCENTS, THEMES, useSettings, ZOOM_MAX, ZOOM_MIN, type IdentityProfile } from './store';
import { applyProfileToRepo } from './profiles';
import { AccountsTab, providerIcon } from './AccountsTab';
import { Field, SettingCard, SettingEmpty, SettingRow } from './SettingCard';
import { getAiProvider } from '@/features/ai/client';
import { modKey } from '@/shared/utils';

type SectionId = 'appearance' | 'git' | 'accounts' | 'ai' | 'shortcuts';

const SECTIONS: Array<{
  id: SectionId;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'appearance', label: 'Appearance', description: 'Theme, accent color, zoom and motion', icon: Palette },
  { id: 'git', label: 'Git', description: 'Auto fetch, pull requests, identity and profiles', icon: User },
  { id: 'accounts', label: 'Authentication', description: 'https:// remotes use accounts · git@ remotes use SSH keys', icon: Github },
  { id: 'ai', label: 'AI Assistant', description: 'Provider, connection and message style', icon: Sparkles },
  { id: 'shortcuts', label: 'Shortcuts', description: 'Keyboard reference', icon: Keyboard },
];

function SshCard() {
  const settings = useSettings();
  const [publicKey, setPublicKey] = useState('');
  const [busy, setBusy] = useState(false);

  const keyPath = settings.sshKeyPath.trim() || '~/.ssh/id_ed25519';

  const showPublicKey = async () => {
    setBusy(true);
    try {
      setPublicKey(await ipc.sshPublicKey(keyPath));
    } catch (error) {
      setPublicKey('');
      toast.error(`${(error as { message?: string }).message ?? error}`);
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    setBusy(true);
    try {
      const created = await ipc.sshKeyGenerate('~/.ssh/angkorgit_ed25519', 'AngKorGit');
      settings.setSshKeyPath(created.path);
      setPublicKey(created.publicKey);
      toast.success(`Created ${created.path} — add the public key to your host`, {
        description:
          'Other tools keep using ~/.ssh/id_* unless you add this path to ~/.ssh/config.',
      });
    } catch (error) {
      toast.error(`${(error as { message?: string }).message ?? error}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingCard
      title="SSH"
      description="Used for git@… remotes; https:// remotes use the accounts above instead."
    >
      <div className="flex flex-col gap-3">
        <SettingRow
          title="Use the SSH agent"
          description="Tried before any key file, and the only way a passphrase-protected key can work."
          control={<Switch checked={settings.sshUseAgent} onCheckedChange={settings.setSshUseAgent} />}
        />

        <Field label="Private key">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <KeyRound className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
              <Input
                className="pl-8"
                value={settings.sshKeyPath}
                onChange={(e) => settings.setSshKeyPath(e.target.value)}
                placeholder="~/.ssh/id_ed25519"
              />
            </div>
            <Hint label="Browse for a key">
              <Button
                variant="secondary"
                size="icon"
                aria-label="Browse for a private key"
                onClick={async () => {
                  const picked = await pickFile('Choose an SSH private key');
                  if (picked) settings.setSshKeyPath(picked);
                }}
              >
                <FolderOpen />
              </Button>
            </Hint>
          </div>
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void showPublicKey()}>
            Show public key
          </Button>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void generate()}>
            {busy ? <Spinner /> : null}
            Generate a key
          </Button>
        </div>

        {publicKey && (
          <div className="flex flex-col gap-2 rounded-md border border-border-subtle bg-surface-raised p-2.5">
            <p className="break-all font-mono text-xs text-muted">{publicKey}</p>
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() => {
                void navigator.clipboard.writeText(publicKey);
                toast.success('Public key copied — paste it into your host');
              }}
            >
              <Copy /> Copy public key
            </Button>
          </div>
        )}
      </div>
    </SettingCard>
  );
}

function CredentialHelperCard() {
  const useCredentialHelper = useSettings((s) => s.useCredentialHelper);
  const setUseCredentialHelper = useSettings((s) => s.setUseCredentialHelper);
  return (
    <SettingCard
      title="System credential helper"
      description="After your accounts, fall back to credentials saved by git or another client. Turn off to test the accounts on their own."
      action={<Switch checked={useCredentialHelper} onCheckedChange={setUseCredentialHelper} />}
    />
  );
}

function ModelField() {
  const ai = useSettings((s) => s.ai);
  const setAi = useSettings((s) => s.setAi);
  const [models, setModels] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const preset = AI_PROVIDER_PRESETS[ai.provider];

  useEffect(() => {
    setModels([]);
    setOpen(false);
  }, [ai.provider]);

  const load = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    if (models.length > 0) {
      setOpen(true);
      return;
    }
    const { ai: current } = useSettings.getState();
    if (preset.needsApiKey && !current.apiKey) {
      toast.info('Enter your API key first — the model list is specific to your account');
      return;
    }
    setLoading(true);
    try {
      const found = await listAiModels({ ...current, baseUrl: current.baseUrl || undefined }, (request) =>
        ipc.httpRequest(request),
      );
      setModels(found);
      setOpen(found.length > 0);
      if (found.length === 0) toast.info('The provider returned no models');
    } catch (error) {
      toast.error(`Could not load models: ${(error as { message?: string }).message ?? error}`);
    } finally {
      setLoading(false);
    }
  };

  const refresh = async () => {
    setModels([]);
    setOpen(false);
    await load();
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted">
          Model <span className="font-normal text-faint">· type any name or load the list your key can access</span>
        </span>
        <div className="flex items-center gap-1">
          {models.length > 0 && !open && (
            <Hint label="Fetch the list again">
              <Button variant="ghost" size="icon-sm" aria-label="Refresh model list" onClick={() => void refresh()} disabled={loading}>
                <RefreshCw className="size-3.5" />
              </Button>
            </Hint>
          )}
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? <Spinner /> : <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />}
            {open ? 'Hide models' : models.length > 0 ? 'Show models' : 'Load models'}
          </Button>
        </div>
      </div>
      <Input
        value={ai.model}
        onChange={(e) => setAi({ model: e.target.value })}
        placeholder={preset.defaultModel}
      />
      {open && (
        <div className="max-h-44 overflow-y-auto rounded-md border border-border-subtle">
          {models.map((model) => {
            const isActive = ai.model === model;
            return (
              <button
                key={model}
                onClick={() => {
                  setAi({ model });
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors',
                  isActive ? 'bg-primary/10 text-foreground' : 'hover:bg-surface-raised',
                )}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{model}</span>
                {isActive && <Check className="size-3.5 shrink-0 text-primary" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CliAgentPicker() {
  const ai = useSettings((s) => s.ai);
  const [agents, setAgents] = useState<CliAgentInfo[]>([]);
  const [scanning, setScanning] = useState(true);

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      const found = await ipc.aiCliDetect();
      setAgents(found);
      const { ai: current, setAi } = useSettings.getState();
      if (found.length > 0 && !found.some((a) => a.id === current.cliAgent)) {
        setAi({ cliAgent: found[0].id, cliPath: found[0].path });
      } else {
        const selected = found.find((a) => a.id === current.cliAgent);
        if (selected && selected.path !== current.cliPath) setAi({ cliPath: selected.path });
      }
    } catch {
      setAgents([]);
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    void scan();
  }, [scan]);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted">Detected on this machine</span>
        <Button variant="ghost" size="sm" onClick={() => void scan()} disabled={scanning}>
          {scanning ? <Spinner /> : <RefreshCw className="size-3.5" />}
          Scan again
        </Button>
      </div>
      {agents.map((agent) => {
        const isActive = ai.cliAgent === agent.id;
        return (
          <button
            key={agent.id}
            onClick={() => useSettings.getState().setAi({ cliAgent: agent.id, cliPath: agent.path })}
            className={cn(
              'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
              isActive ? 'border-primary/40 bg-primary/5' : 'border-border-subtle bg-surface-raised/40 hover:border-border',
            )}
          >
            <span
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-md',
                isActive ? 'bg-primary/15 text-primary' : 'bg-surface text-muted',
              )}
            >
              <SquareTerminal className="size-4" />
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                <span className="truncate">{agent.label}</span>
                {isActive && (
                  <Badge tone="primary">
                    <Check className="size-3" /> In use
                  </Badge>
                )}
                {agent.version && <span className="font-mono text-[11px] font-normal text-faint">{agent.version}</span>}
              </p>
              <p className="truncate font-mono text-[11px] text-faint">{agent.path}</p>
            </div>
          </button>
        );
      })}
      {scanning && agents.length === 0 && (
        <div className="flex items-center gap-2.5 rounded-md border border-border-subtle p-2.5">
          <div className="size-8 animate-pulse rounded-md bg-surface-raised" />
          <div className="flex flex-1 flex-col gap-1.5">
            <div className="h-3.5 w-32 animate-pulse rounded bg-surface-raised" />
            <div className="h-3 w-56 animate-pulse rounded bg-surface-raised" />
          </div>
        </div>
      )}
      {!scanning && agents.length === 0 && (
        <SettingEmpty
          icon={<SquareTerminal className="size-4" />}
          title="No AI CLI found"
          description="Install Claude Code, Codex CLI, Gemini CLI, OpenCode or Antigravity CLI, then scan again."
          action={
            <Button variant="secondary" size="sm" onClick={() => void scan()}>
              <RefreshCw className="size-3.5" /> Scan again
            </Button>
          }
        />
      )}
      <p className="mt-1 text-[11px] leading-relaxed text-faint">
        Requests run through the CLI on this machine with its own login and quota. AngKorGit stores no key and
        sends nothing anywhere itself.
      </p>
    </div>
  );
}

function CommitStyleCard() {
  const commit = useSettings((s) => s.aiStyle.commit);
  const setCommitStyle = useSettings((s) => s.setCommitStyle);
  const branch = useRepo((s) => s.status?.branch ?? null);

  const updateRule = (index: number, patch: Partial<{ pattern: string; prefix: string }>) => {
    setCommitStyle({
      prefixRules: commit.prefixRules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)),
    });
  };
  const removeRule = (index: number) => {
    setCommitStyle({ prefixRules: commit.prefixRules.filter((_, i) => i !== index) });
  };

  const preview = branch ? resolveCommitPrefix(commit.prefixRules, branch) : null;

  return (
    <SettingCard
      title="Commit message style"
      description={COMMIT_STYLE_PRESETS[commit.preset].description}
      action={
        <Select
          value={commit.preset}
          onValueChange={(value) => setCommitStyle({ preset: value as CommitStylePreset })}
        >
          <SelectTrigger className="h-8 w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(COMMIT_STYLE_PRESETS) as CommitStylePreset[]).map((preset) => (
              <SelectItem key={preset} value={preset}>
                {COMMIT_STYLE_PRESETS[preset].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      <div className="flex flex-col gap-3">
        {commit.preset === 'custom' && (
          <Field label="Your convention, in plain words">
            <Textarea
              value={commit.instructions}
              onChange={(e) => setCommitStyle({ instructions: e.target.value })}
              placeholder={
                'e.g. Start with the affected module in brackets, write in past tense, and never use conventional-commit types.'
              }
              rows={3}
            />
          </Field>
        )}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">
              Branch prefix rules <span className="font-normal text-faint">· first match wins, applied by AngKorGit itself</span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setCommitStyle({ prefixRules: [...commit.prefixRules, { pattern: '', prefix: '' }] })
              }
            >
              <Plus className="size-3.5" />
              Add rule
            </Button>
          </div>
          {commit.prefixRules.length > 0 ? (
            <div className="flex flex-col divide-y divide-border-subtle rounded-lg border border-border-subtle bg-surface-raised/40">
              <div className="grid grid-cols-[1fr_auto_1fr_28px] items-center gap-2 px-2.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-faint">
                <span>Branch matches</span>
                <span />
                <span>Message starts with</span>
                <span />
              </div>
              {commit.prefixRules.map((rule, index) => (
                <div key={index} className="grid grid-cols-[1fr_auto_1fr_28px] items-center gap-2 px-2.5 py-2">
                  <Input
                    value={rule.pattern}
                    onChange={(e) => updateRule(index, { pattern: e.target.value })}
                    placeholder="feature/*"
                    className="h-8 font-mono text-xs"
                  />
                  <span className="text-xs text-faint">→</span>
                  <Input
                    value={rule.prefix}
                    onChange={(e) => updateRule(index, { prefix: e.target.value })}
                    placeholder="[{suffix}]"
                    className="h-8 font-mono text-xs"
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove rule"
                    onClick={() => removeRule(index)}
                  >
                    <Trash2 className="size-3.5 text-danger" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-border-subtle px-3 py-2.5 text-xs text-faint">
              No rules. Add one to prefix messages by branch, for example{' '}
              <span className="font-mono">feature/*</span> → <span className="font-mono">[{'{suffix}'}]</span>.
            </p>
          )}
          <p className="text-[11px] leading-relaxed text-faint">
            <span className="font-mono">*</span> matches any part of the branch name. Prefix tokens:{' '}
            <span className="font-mono">{'{branch}'}</span>, <span className="font-mono">{'{suffix}'}</span>,{' '}
            <span className="font-mono">{'{ticket}'}</span>.
          </p>
          {branch && commit.prefixRules.length > 0 && (
            <p className="flex flex-wrap items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-xs text-muted">
              On <span className="font-mono text-foreground">{branch}</span>
              {preview ? (
                <>
                  messages start with <span className="font-mono text-foreground">{preview}</span>
                </>
              ) : (
                <>messages get no prefix, no rule matches</>
              )}
            </p>
          )}
        </div>
      </div>
    </SettingCard>
  );
}

function ReviewStyleCard() {
  const review = useSettings((s) => s.aiStyle.review);
  const setReviewStyle = useSettings((s) => s.setReviewStyle);

  return (
    <SettingCard
      title="AI review conventions"
      description="What the AI reviewer pays attention to when it reviews staged changes. Applies to every repository."
    >
      <div className="flex flex-col gap-2">
        <Textarea
          value={review.instructions}
          onChange={(e) => setReviewStyle({ instructions: e.target.value })}
          placeholder={
            'e.g. Flag any raw SQL outside the repository layer. We use React hooks only, no class components. Be strict about missing error handling and missing tests.'
          }
          rows={4}
        />
        <p className="text-[11px] leading-relaxed text-faint">
          Per-project rules: commit <span className="rounded bg-surface-raised px-1 py-0.5 font-mono">{PROJECT_REVIEW_FILE}</span>{' '}
          to a repository and its content joins these conventions for that repository, so the whole team
          reviews by the same rules. Project rules win on conflict.
        </p>
      </div>
    </SettingCard>
  );
}

const SHORTCUTS: Array<[string, string[]]> = [
  ['Command palette', ['mod', 'K / P']],
  ['Toggle terminal', ['mod', '`']],
  ['Toggle sidebar', ['mod', 'B']],
  ['Undo / redo operation', ['mod', 'Z / ⇧Z']],
  ['Refresh repository', ['mod', 'R']],
  ['Settings', ['mod', ',']],
  ['Commit staged changes', ['mod', '⏎']],
  ['Previous / next commit', ['↑ / ↓']],
  ['First / last commit', ['Home / End']],
  ['Search commits / find in diff', ['mod', 'F']],
  ['Previous match (find in diff)', ['⇧', '⏎']],
  ['Select / copy diff side', ['mod', 'A / C']],
  ['Save (file editor)', ['mod', 'S']],
  ['Zoom in / out / reset', ['mod', '+ / − / 0']],
  ['Previous / next change (diff)', ['P / N']],
  ['Previous / next file (diff)', ['[ / ]']],
  ['Close diff view', ['Esc']],
];

export function SettingsDialog() {
  const repo = useRepo((s) => s.repo);
  const { dialog, closeDialog } = useUi();
  const open = dialog === 'settings';
  const settings = useSettings();

  const [section, setSection] = useState<SectionId>('appearance');
  const [gitName, setGitName] = useState('');
  const [gitEmail, setGitEmail] = useState('');
  const [testing, setTesting] = useState(false);
  const [aiStatus, setAiStatus] = useState<'unknown' | 'ok' | 'fail'>('unknown');
  const [profileLabel, setProfileLabel] = useState('');
  const [profileName, setProfileName] = useState('');
  const [profileEmail, setProfileEmail] = useState('');
  const [hostAccounts, setHostAccounts] = useState<HostingAccount[]>([]);
  const [addingProfile, setAddingProfile] = useState(false);

  useEffect(() => {
    if (!open) return;
    void ipc
      .configGet(repo?.path ?? null, 'user.name')
      .then((v) => setGitName(v ?? ''))
      .catch(() => undefined);
    void ipc
      .configGet(repo?.path ?? null, 'user.email')
      .then((v) => setGitEmail(v ?? ''))
      .catch(() => undefined);
  }, [open, repo]);

  useEffect(() => {
    if (!open) return;
    void ipc
      .accountList()
      .then(setHostAccounts)
      .catch(() => undefined);
  }, [open, section]);

  const saveIdentity = async () => {
    try {
      await ipc.configSet(repo?.path ?? null, 'user.name', gitName, !repo);
      await ipc.configSet(repo?.path ?? null, 'user.email', gitEmail, !repo);
      toast.success('Git identity saved');
    } catch (error) {
      toast.error(`Save failed: ${(error as { message?: string }).message ?? error}`);
    }
  };

  const applyProfile = async (profile: IdentityProfile) => {
    try {
      if (repo) {
        await applyProfileToRepo(repo.path, profile);
      } else {
        await ipc.configSet(null, 'user.name', profile.name, true);
        await ipc.configSet(null, 'user.email', profile.email, true);
      }
      setGitName(profile.name);
      setGitEmail(profile.email);
      toast.success(
        repo
          ? `${repo.name} now uses the "${profile.label}" profile`
          : `Global identity set to "${profile.label}"`,
      );
    } catch (error) {
      toast.error(`Apply failed: ${(error as { message?: string }).message ?? error}`);
    }
  };

  const setProfileHostAccount = (profile: IdentityProfile, host: string, username: string | null) => {
    const accounts = { ...(profile.accounts ?? {}) };
    if (username === null) delete accounts[host];
    else accounts[host] = username;
    settings.updateProfile(profile.id, { accounts });
  };
  const accountsByHost = hostAccounts.reduce<Record<string, HostingAccount[]>>((acc, account) => {
    (acc[account.host] ??= []).push(account);
    return acc;
  }, {});
  const multiAccountHosts = Object.keys(accountsByHost)
    .filter((host) => accountsByHost[host].length > 1)
    .sort();

  const addProfile = () => {
    if (!profileLabel.trim() || !profileName.trim() || !profileEmail.trim()) return;
    settings.addProfile({
      label: profileLabel.trim(),
      name: profileName.trim(),
      email: profileEmail.trim(),
    });
    setProfileLabel('');
    setProfileName('');
    setProfileEmail('');
    setAddingProfile(false);
  };
  const removeProfile = async (profile: IdentityProfile) => {
    const ok = await confirmDialog({
      title: `Remove profile "${profile.label}"?`,
      description:
        'Repositories already assigned to it keep the identity written in their config; they just lose the profile link.',
      confirmLabel: 'Remove profile',
      destructive: true,
    });
    if (ok) settings.removeProfile(profile.id);
  };

  const testAi = async () => {
    setTesting(true);
    try {
      const ok = await getAiProvider().ping();
      setAiStatus(ok ? 'ok' : 'fail');
    } catch {
      setAiStatus('fail');
    } finally {
      setTesting(false);
    }
  };
  useEffect(() => {
    setAiStatus('unknown');
  }, [settings.ai.provider, settings.ai.baseUrl, settings.ai.apiKey, settings.ai.cliAgent]);

  const preset = AI_PROVIDER_PRESETS[settings.ai.provider];
  const active = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];
  const activeProfile =
    settings.profiles.find((p) => p.email === gitEmail && p.name === gitName) ?? null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeDialog()}>
      <DialogContent className="max-w-3xl overflow-hidden p-0">
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <div className="flex h-[560px] max-h-[80vh]">
          <nav className="flex w-52 shrink-0 flex-col border-r border-border-subtle bg-surface">
            <p className="px-4 pb-2 pt-4 text-xs font-semibold uppercase tracking-wide text-faint">
              Settings
            </p>
            <div className="flex-1 px-2">
              {SECTIONS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setSection(id)}
                  className={cn(
                    'mb-0.5 flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                    section === id
                      ? 'bg-primary/10 font-medium text-primary'
                      : 'text-muted hover:bg-surface-raised hover:text-foreground',
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  {label}
                </button>
              ))}
            </div>
            <div className="border-t border-border-subtle px-4 py-3">
              <div className="flex items-center gap-2">
                <Logo size={18} className="text-foreground" />
                <span className="text-xs text-faint">AngKorGit</span>
              </div>
            </div>
          </nav>

          <div className="flex min-w-0 flex-1 flex-col bg-background">
            <header className="shrink-0 border-b border-border-subtle px-6 pb-4 pt-5">
              <h2 className="text-base font-semibold">{active.label}</h2>
              <p className="mt-0.5 text-xs text-muted">{active.description}</p>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              {section === 'appearance' && (
                <div className="flex flex-col gap-4">
                  <SettingCard
                    title="Theme"
                    description="Popular editor palettes — surfaces and syntax colors follow the theme."
                  >
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {THEMES.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => settings.setTheme(t.id)}
                          aria-label={`Theme: ${t.label}`}
                          className={cn(
                            'group flex flex-col overflow-hidden rounded-lg border text-left transition-colors',
                            settings.theme === t.id
                              ? 'border-primary ring-1 ring-primary'
                              : 'border-border hover:border-muted',
                          )}
                        >
                          <span
                            className="flex h-14 flex-col justify-center gap-1.5 px-3"
                            style={{ backgroundColor: t.swatch.bg }}
                          >
                            <span className="flex items-center gap-1">
                              {t.swatch.dots.map((dot) => (
                                <span
                                  key={dot}
                                  className="size-2 rounded-full"
                                  style={{ backgroundColor: dot }}
                                />
                              ))}
                            </span>
                            <span
                              className="h-1.5 w-3/4 rounded-full opacity-60"
                              style={{ backgroundColor: t.swatch.fg }}
                            />
                            <span
                              className="h-1.5 w-1/2 rounded-full opacity-30"
                              style={{ backgroundColor: t.swatch.fg }}
                            />
                          </span>
                          <span
                            className={cn(
                              'flex items-center justify-between px-3 py-1.5 text-xs',
                              settings.theme === t.id ? 'text-primary' : 'text-muted group-hover:text-foreground',
                            )}
                          >
                            {t.label}
                            {t.base === 'dark' ? <Moon className="size-3" /> : <Sun className="size-3" />}
                          </span>
                        </button>
                      ))}
                    </div>
                  </SettingCard>

                  <SettingCard
                    title="Accent color"
                    description="Buttons, highlights and focus follow your accent. Graph and diff colors keep their meaning."
                  >
                    <div className="flex items-center gap-3">
                      {ACCENTS.map((accent) => (
                        <Hint key={accent.id} label={accent.label}>
                          <button
                            aria-label={`Accent: ${accent.label}`}
                            onClick={() => settings.setAccent(accent.id)}
                            className={cn(
                              'flex size-8 items-center justify-center rounded-full transition-transform hover:scale-110',
                              settings.accent === accent.id &&
                                'ring-2 ring-foreground/70 ring-offset-2 ring-offset-background',
                            )}
                            style={{ background: accent.color }}
                          >
                            {settings.accent === accent.id && <Check className="size-4 text-white drop-shadow" />}
                          </button>
                        </Hint>
                      ))}
                    </div>
                  </SettingCard>

                  <SettingCard
                    title="Zoom"
                    description={
                      <>
                        Also <Kbd>{modKey()}</Kbd> <Kbd>+</Kbd> / <Kbd>{modKey()}</Kbd> <Kbd>−</Kbd> anywhere
                      </>
                    }
                    action={
                      <div className="flex items-center gap-1">
                        <Button
                          variant="secondary"
                          size="icon-sm"
                          aria-label="Zoom out"
                          disabled={settings.zoom <= ZOOM_MIN}
                          onClick={settings.zoomOut}
                        >
                          <Minus className="size-3.5" />
                        </Button>
                        <button
                          className="w-14 text-center font-mono text-xs text-muted hover:text-foreground"
                          title="Reset zoom"
                          onClick={settings.zoomReset}
                        >
                          {Math.round(settings.zoom * 100)}%
                        </button>
                        <Button
                          variant="secondary"
                          size="icon-sm"
                          aria-label="Zoom in"
                          disabled={settings.zoom >= ZOOM_MAX}
                          onClick={settings.zoomIn}
                        >
                          <Plus className="size-3.5" />
                        </Button>
                      </div>
                    }
                  />

                  <SettingCard
                    title="Reduce motion"
                    description="Minimize animations across the app"
                    action={<Switch checked={settings.reduceMotion} onCheckedChange={settings.setReduceMotion} />}
                  />
                </div>
              )}

              {section === 'git' && (
                <div className="flex flex-col gap-4">
                  <SettingCard
                    title="Auto fetch"
                    description="Fetch from the first remote in the background so teammates' commits show up by themselves. Failures stay silent."
                    action={
                      <Select
                        value={String(settings.autoFetchMinutes)}
                        onValueChange={(v) => settings.setAutoFetchMinutes(Number(v))}
                      >
                        <SelectTrigger className="h-8 w-36">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="0">Off</SelectItem>
                          <SelectItem value="1">Every minute</SelectItem>
                          <SelectItem value="5">Every 5 minutes</SelectItem>
                          <SelectItem value="15">Every 15 minutes</SelectItem>
                        </SelectContent>
                      </Select>
                    }
                  />

                  <SettingCard
                    title="Pull requests"
                    description="Show the pull requests section in the sidebar, loaded through your connected account."
                    action={
                      <Switch
                        checked={settings.showPullRequests}
                        onCheckedChange={settings.setShowPullRequests}
                      />
                    }
                  />

                  <SettingCard
                    title={repo ? 'Identity for this repository' : 'Global identity'}
                    description={
                      repo
                        ? 'The name and email written on commits made here. Saved to this repository, so it wins over your global git config.'
                        : 'The name and email written on commits when a repository has no identity of its own.'
                    }
                    action={
                      activeProfile ? (
                        <Badge tone="primary" className="mt-0.5">
                          <UserRound className="size-3" /> {activeProfile.label}
                        </Badge>
                      ) : undefined
                    }
                  >
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Name">
                        <Input value={gitName} onChange={(e) => setGitName(e.target.value)} placeholder="Your Name" />
                      </Field>
                      <Field label="Email">
                        <Input
                          value={gitEmail}
                          onChange={(e) => setGitEmail(e.target.value)}
                          placeholder="you@example.com"
                        />
                      </Field>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <span className="text-[11px] text-faint">
                        {repo ? `Writes user.name and user.email to ${repo.name}/.git/config` : 'Writes user.name and user.email to ~/.gitconfig'}
                      </span>
                      <Button size="sm" onClick={() => void saveIdentity()}>
                        Save identity
                      </Button>
                    </div>
                  </SettingCard>

                  <SettingCard
                    title="Profiles"
                    description={
                      multiAccountHosts.length > 0
                        ? 'Work and personal identities, each with the account it should use on hosts where you have several. A repository is assigned to one profile the first time you commit or push, and that choice stays with the repository.'
                        : 'Work and personal identities. A repository is assigned to one profile the first time you commit or push, and that choice stays with the repository. With one account per host, every profile uses it automatically.'
                    }
                    action={
                      !addingProfile && settings.profiles.length > 0 ? (
                        <Button variant="secondary" size="sm" onClick={() => setAddingProfile(true)}>
                          <Plus className="size-3.5" /> New profile
                        </Button>
                      ) : undefined
                    }
                  >
                    <div className="flex flex-col gap-2">
                      {settings.profiles.map((profile) => {
                        const isActive = activeProfile?.id === profile.id;
                        return (
                          <div
                            key={profile.id}
                            className={cn(
                              'rounded-lg border p-3 transition-colors',
                              isActive ? 'border-primary/40 bg-primary/5' : 'border-border-subtle bg-surface-raised/40',
                            )}
                          >
                            <div className="flex items-center gap-3">
                              <Avatar name={profile.name} email={profile.email} size={32} />
                              <div className="min-w-0 flex-1 leading-tight">
                                <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                                  <span className="truncate">{profile.label}</span>
                                  {isActive && (
                                    <Badge tone="primary">
                                      <Check className="size-3" /> {repo ? 'In use here' : 'In use'}
                                    </Badge>
                                  )}
                                </p>
                                <p className="truncate text-xs text-faint">
                                  {profile.name} · {profile.email}
                                </p>
                              </div>
                              {!isActive && (
                                <Button variant="secondary" size="sm" onClick={() => void applyProfile(profile)}>
                                  {repo ? 'Use for this repo' : 'Use'}
                                </Button>
                              )}
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon-sm" aria-label={`${profile.label} profile actions`}>
                                    <MoreHorizontal className="size-3.5" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem disabled={isActive} onClick={() => void applyProfile(profile)}>
                                    <Check /> {repo ? 'Use for this repo' : 'Use as global identity'}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem destructive onClick={() => void removeProfile(profile)}>
                                    <Trash2 /> Remove profile…
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                            {multiAccountHosts.length > 0 && (
                              <div className="mt-3 flex flex-col gap-1.5 border-t border-border-subtle pt-2.5">
                                <span className="text-[11px] font-medium text-faint">
                                  Account to use per host
                                </span>
                                {multiAccountHosts.map((host) => {
                                  const options = accountsByHost[host];
                                  const fallback = options.find((a) => a.isDefault) ?? options[0];
                                  const chosen = profile.accounts?.[host];
                                  const value = chosen && options.some((a) => a.username === chosen) ? chosen : '__default';
                                  return (
                                    <div key={host} className="flex items-center gap-2">
                                      <span className="flex size-6 shrink-0 items-center justify-center rounded bg-surface text-muted [&_svg]:size-3.5">
                                        {providerIcon(options[0].provider)}
                                      </span>
                                      <span className="min-w-0 flex-1 truncate text-xs text-foreground">{host}</span>
                                      <Select
                                        value={value}
                                        onValueChange={(v) => setProfileHostAccount(profile, host, v === '__default' ? null : v)}
                                      >
                                        <SelectTrigger className="h-7 w-52 text-xs" aria-label={`Account for ${host} in ${profile.label}`}>
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="__default">
                                            Host default <span className="text-faint">· {fallback.username}</span>
                                          </SelectItem>
                                          {options.map((account) => (
                                            <SelectItem key={account.username} value={account.username}>
                                              {account.username}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {settings.profiles.length === 0 && !addingProfile && (
                        <SettingEmpty
                          icon={<UsersRound className="size-4" />}
                          title="No profiles yet"
                          description="Add Work and Personal once, then every repository picks the right name, email and account."
                          action={
                            <Button variant="secondary" size="sm" onClick={() => setAddingProfile(true)}>
                              <Plus className="size-3.5" /> New profile
                            </Button>
                          }
                        />
                      )}

                      {addingProfile && (
                        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                          <p className="mb-3 text-xs font-medium text-foreground">New profile</p>
                          <div className="grid grid-cols-3 gap-3">
                            <Field label="Label">
                              <Input
                                autoFocus
                                placeholder="Work"
                                value={profileLabel}
                                onChange={(e) => setProfileLabel(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') addProfile();
                                  if (e.key === 'Escape') setAddingProfile(false);
                                }}
                              />
                            </Field>
                            <Field label="Name">
                              <Input
                                placeholder="Your Name"
                                value={profileName}
                                onChange={(e) => setProfileName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') addProfile();
                                  if (e.key === 'Escape') setAddingProfile(false);
                                }}
                              />
                            </Field>
                            <Field label="Email">
                              <Input
                                placeholder="you@company.com"
                                value={profileEmail}
                                onChange={(e) => setProfileEmail(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') addProfile();
                                  if (e.key === 'Escape') setAddingProfile(false);
                                }}
                              />
                            </Field>
                          </div>
                          <div className="mt-3 flex items-center justify-between gap-3">
                            <span className="text-[11px] text-faint">
                              Link hosting accounts to the profile after adding it.
                            </span>
                            <span className="flex gap-2">
                              <Button variant="ghost" size="sm" onClick={() => setAddingProfile(false)}>
                                Cancel
                              </Button>
                              <Button
                                size="sm"
                                disabled={!profileLabel.trim() || !profileName.trim() || !profileEmail.trim()}
                                onClick={addProfile}
                              >
                                Add profile
                              </Button>
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </SettingCard>
                </div>
              )}

              {section === 'accounts' && (
                <div className="flex flex-col gap-4">
                  <AccountsTab />
                  <CredentialHelperCard />
                  <SshCard />
                </div>
              )}

              {section === 'ai' && (
                <div className="flex flex-col gap-4">
                  <SettingCard
                    title="Provider"
                    description={
                      settings.ai.provider === 'cli'
                        ? 'Uses an AI CLI already installed on this machine — Claude Code, Codex, Gemini CLI, OpenCode or Antigravity — with its own login and quota. No API key needed.'
                        : 'Used for commit messages, diff explanations, conflict help and reviews. Local models via Ollama or LM Studio need no API key.'
                    }
                    action={
                      <Select
                        value={settings.ai.provider}
                        onValueChange={(value) => settings.setAiProvider(value as AiProviderKind)}
                      >
                        <SelectTrigger className="h-8 w-48">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(AI_PROVIDER_PRESETS) as AiProviderKind[]).map((kind) => (
                            <SelectItem key={kind} value={kind}>
                              {AI_PROVIDER_PRESETS[kind].label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    }
                  >
                    <div className="flex flex-col gap-3">
                      {settings.ai.provider === 'cli' ? (
                        <>
                          <CliAgentPicker />
                          <Field label="Model override" hint="optional, the CLI's default when empty">
                            <Input
                              value={settings.ai.model}
                              onChange={(e) => settings.setAi({ model: e.target.value })}
                              placeholder="CLI default"
                            />
                          </Field>
                        </>
                      ) : (
                        <>
                          {preset.needsApiKey && (
                            <Field label="API key">
                              <Input
                                type="password"
                                value={settings.ai.apiKey}
                                onChange={(e) => settings.setAi({ apiKey: e.target.value })}
                                placeholder="sk-…"
                              />
                            </Field>
                          )}
                          <Field label="Base URL" hint={`optional, defaults to ${preset.defaultBaseUrl}`}>
                            <Input
                              value={settings.ai.baseUrl ?? ''}
                              onChange={(e) => settings.setAi({ baseUrl: e.target.value })}
                              placeholder={preset.defaultBaseUrl}
                            />
                          </Field>
                          <ModelField />
                        </>
                      )}
                      <div className="flex items-center justify-between gap-3 border-t border-border-subtle pt-3">
                        <span className="flex items-center gap-1.5 text-xs">
                          {aiStatus === 'ok' && (
                            <>
                              <span className="size-1.5 rounded-full bg-success" />
                              <span className="text-success">Reachable</span>
                            </>
                          )}
                          {aiStatus === 'fail' && (
                            <>
                              <span className="size-1.5 rounded-full bg-danger" />
                              <span className="text-danger">Not reachable. Check the key, URL or that the local server is running.</span>
                            </>
                          )}
                          {aiStatus === 'unknown' && <span className="text-faint">Connection not tested yet</span>}
                        </span>
                        <Button variant="secondary" size="sm" onClick={() => void testAi()} disabled={testing}>
                          {testing ? <Spinner /> : <Wifi className="size-3.5" />}
                          Test connection
                        </Button>
                      </div>
                    </div>
                  </SettingCard>
                  <CommitStyleCard />
                  <ReviewStyleCard />
                </div>
              )}

              {section === 'shortcuts' && (
                <SettingCard title="Keyboard shortcuts">
                  <div className="flex flex-col">
                    {SHORTCUTS.map(([label, keys], index) => (
                      <div key={label}>
                        {index > 0 && <Separator />}
                        <div className="flex items-center justify-between py-2.5">
                          <span className="text-sm">{label}</span>
                          <span className="flex items-center gap-1">
                            {keys.map((key) => (
                              <Kbd key={key}>{key === 'mod' ? modKey() : key}</Kbd>
                            ))}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </SettingCard>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
