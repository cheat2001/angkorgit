import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Check,
  Github,
  Keyboard,
  KeyRound,
  Minus,
  Moon,
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
  resolveCommitPrefix,
  type AiProviderKind,
  type CliAgentInfo,
  type CommitStylePreset,
} from '@angkorgit/core';
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
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
import { ipc } from '@/core/ipc';
import { useRepo } from '@/features/repository/store';
import { useUi } from '@/features/ui/store';
import { ACCENTS, THEMES, useSettings, ZOOM_MAX, ZOOM_MIN } from './store';
import { AccountsTab } from './AccountsTab';
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
  { id: 'git', label: 'Git', description: 'Committer identity and identity profiles', icon: User },
  { id: 'accounts', label: 'Accounts', description: 'Hosting accounts for push and pull over HTTPS', icon: Github },
  { id: 'ai', label: 'AI Assistant', description: 'Provider, connection and message style', icon: Sparkles },
  { id: 'shortcuts', label: 'Shortcuts', description: 'Keyboard reference', icon: Keyboard },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

function SettingCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h3 className="text-sm font-medium">{title}</h3>
      {description && <p className="mt-0.5 text-xs text-faint">{description}</p>}
      <div className="mt-3">{children}</div>
    </section>
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
              'flex items-center gap-2.5 rounded-md border p-2.5 text-left transition-colors',
              isActive ? 'border-primary/50 bg-primary/10' : 'border-border-subtle hover:border-muted',
            )}
          >
            <SquareTerminal className={cn('size-4 shrink-0', isActive ? 'text-primary' : 'text-muted')} />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-sm">
                {agent.label}
                {isActive && <Check className="size-3.5 text-primary" />}
              </p>
              <p className="truncate text-xs text-faint">
                {agent.version ? `${agent.version} · ` : ''}
                {agent.path}
              </p>
            </div>
          </button>
        );
      })}
      {!scanning && agents.length === 0 && (
        <p className="rounded-md border border-dashed border-border p-3 text-xs text-faint">
          No AI CLI found. Install Claude Code, Codex CLI, Gemini CLI or OpenCode, then scan again.
        </p>
      )}
      <p className="mt-1 text-xs text-faint">
        Requests run through your CLI locally and use its own login and quota — AngKorGit stores no key
        and sends nothing anywhere itself.
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
      description="How generated commit messages are written. Branch prefix rules are applied by AngKorGit itself, so they always hold."
    >
      <div className="flex flex-col gap-3">
        <Select
          value={commit.preset}
          onValueChange={(value) => setCommitStyle({ preset: value as CommitStylePreset })}
        >
          <SelectTrigger>
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
        <p className="-mt-1.5 text-xs text-faint">{COMMIT_STYLE_PRESETS[commit.preset].description}</p>
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
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Branch prefix rules (first match wins)</span>
          {commit.prefixRules.map((rule, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                value={rule.pattern}
                onChange={(e) => updateRule(index, { pattern: e.target.value })}
                placeholder="feature/*"
                className="flex-1 font-mono text-xs"
              />
              <span className="text-xs text-faint">→</span>
              <Input
                value={rule.prefix}
                onChange={(e) => updateRule(index, { prefix: e.target.value })}
                placeholder="[{suffix}]"
                className="flex-1 font-mono text-xs"
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
          <div className="flex items-center justify-between">
            <p className="text-xs text-faint">
              Patterns match the branch name (<span className="font-mono">*</span> wildcard). Prefix
              tokens: <span className="font-mono">{'{branch}'}</span>,{' '}
              <span className="font-mono">{'{suffix}'}</span>,{' '}
              <span className="font-mono">{'{ticket}'}</span>.
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setCommitStyle({ prefixRules: [...commit.prefixRules, { pattern: '', prefix: '' }] })
              }
            >
              <Plus className="size-3.5" />
              Add rule
            </Button>
          </div>
          {branch && commit.prefixRules.length > 0 && (
            <p className="rounded-md border border-border-subtle bg-surface px-2.5 py-1.5 text-xs text-muted">
              On <span className="font-mono">{branch}</span> messages will
              {preview ? (
                <>
                  {' '}
                  start with <span className="font-mono text-foreground">{preview}</span>
                </>
              ) : (
                ' have no prefix (no rule matches)'
              )}
            </p>
          )}
        </div>
      </div>
    </SettingCard>
  );
}

const SHORTCUTS: Array<[string, string[]]> = [
  ['Command palette', ['mod', 'K']],
  ['Toggle terminal', ['mod', '`']],
  ['Toggle sidebar', ['mod', 'B']],
  ['Undo / redo operation', ['mod', 'Z / ⇧Z']],
  ['Refresh repository', ['mod', 'R']],
  ['Settings', ['mod', ',']],
  ['Commit (in message box)', ['mod', '⏎']],
  ['Zoom in / out / reset', ['mod', '+ / − / 0']],
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
  const [profileLabel, setProfileLabel] = useState('');
  const [profileName, setProfileName] = useState('');
  const [profileEmail, setProfileEmail] = useState('');

  useEffect(() => {
    if (!open) return;
    void ipc.configGet(repo?.path ?? null, 'user.name').then((v) => setGitName(v ?? ''));
    void ipc.configGet(repo?.path ?? null, 'user.email').then((v) => setGitEmail(v ?? ''));
  }, [open, repo]);

  const saveIdentity = async () => {
    try {
      await ipc.configSet(repo?.path ?? null, 'user.name', gitName, !repo);
      await ipc.configSet(repo?.path ?? null, 'user.email', gitEmail, !repo);
      toast.success('Git identity saved');
    } catch (error) {
      toast.error(`Save failed: ${(error as { message?: string }).message ?? error}`);
    }
  };

  const applyProfile = async (name: string, email: string, label: string) => {
    try {
      await ipc.configSet(repo?.path ?? null, 'user.name', name, !repo);
      await ipc.configSet(repo?.path ?? null, 'user.email', email, !repo);
      setGitName(name);
      setGitEmail(email);
      toast.success(
        repo ? `Committing to ${repo.name} as "${label}" from now on` : `Global identity set to "${label}"`,
      );
    } catch (error) {
      toast.error(`Apply failed: ${(error as { message?: string }).message ?? error}`);
    }
  };

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
  };

  const testAi = async () => {
    setTesting(true);
    try {
      const ok = await getAiProvider().ping();
      if (ok) toast.success('AI provider reachable');
      else toast.error('AI provider not reachable');
    } catch {
      toast.error('AI provider not reachable');
    } finally {
      setTesting(false);
    }
  };

  const preset = AI_PROVIDER_PRESETS[settings.ai.provider];
  const active = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];

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

                  <SettingCard title="Zoom">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-faint">
                        Also <Kbd>{modKey()}</Kbd> <Kbd>+</Kbd> / <Kbd>{modKey()}</Kbd> <Kbd>−</Kbd> anywhere
                      </p>
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
                    </div>
                  </SettingCard>

                  <SettingCard title="Reduce motion" description="Minimize animations across the app">
                    <Switch checked={settings.reduceMotion} onCheckedChange={settings.setReduceMotion} />
                  </SettingCard>
                </div>
              )}

              {section === 'git' && (
                <div className="flex flex-col gap-4">
                  <SettingCard
                    title="Committer identity"
                    description={
                      repo
                        ? `Saved to this repository's .git/config (wins over the global config).`
                        : 'Saved to your global git config.'
                    }
                  >
                    <div className="flex flex-col gap-3">
                      <Field label="User name">
                        <Input value={gitName} onChange={(e) => setGitName(e.target.value)} placeholder="Your Name" />
                      </Field>
                      <Field label="Email">
                        <Input
                          value={gitEmail}
                          onChange={(e) => setGitEmail(e.target.value)}
                          placeholder="you@example.com"
                        />
                      </Field>
                      <div className="flex justify-end">
                        <Button onClick={() => void saveIdentity()}>Save identity</Button>
                      </div>
                    </div>
                  </SettingCard>

                  <SettingCard
                    title="Identity profiles"
                    description="Save work and personal identities, then switch per repository — applied to that repo's local config only, so other tools can't override it."
                  >
                    <div className="flex flex-col gap-1.5">
                      {settings.profiles.map((profile) => {
                        const isActive = profile.email === gitEmail && profile.name === gitName;
                        return (
                          <div
                            key={profile.id}
                            className={cn(
                              'group flex items-center gap-2 rounded-md border p-2',
                              isActive ? 'border-primary/50 bg-primary/10' : 'border-border-subtle',
                            )}
                          >
                            <UserRound className={cn('size-4 shrink-0', isActive ? 'text-primary' : 'text-muted')} />
                            <div className="min-w-0 flex-1">
                              <p className="flex items-center gap-1.5 text-sm">
                                {profile.label}
                                {isActive && <Check className="size-3.5 text-primary" />}
                              </p>
                              <p className="truncate text-xs text-faint">
                                {profile.name} · {profile.email}
                              </p>
                            </div>
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={isActive}
                              onClick={() => void applyProfile(profile.name, profile.email, profile.label)}
                            >
                              {isActive ? 'Active' : repo ? 'Use for this repo' : 'Use'}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Remove profile ${profile.label}`}
                              className="opacity-0 group-hover:opacity-100"
                              onClick={() => settings.removeProfile(profile.id)}
                            >
                              <Trash2 className="size-3.5 text-danger" />
                            </Button>
                          </div>
                        );
                      })}
                      {settings.profiles.length === 0 && (
                        <p className="flex items-center gap-2 rounded-md border border-dashed border-border p-3 text-xs text-faint">
                          <UsersRound className="size-4" /> No profiles yet — add your Work and Personal identities below.
                        </p>
                      )}
                      <div className="mt-1 flex flex-col gap-2 rounded-md border border-dashed border-border p-2">
                        <div className="flex gap-2">
                          <Input
                            placeholder="Label, e.g. Work"
                            value={profileLabel}
                            onChange={(e) => setProfileLabel(e.target.value)}
                            className="w-32 shrink-0"
                          />
                          <Input placeholder="Name" value={profileName} onChange={(e) => setProfileName(e.target.value)} />
                        </div>
                        <div className="flex gap-2">
                          <Input
                            placeholder="email@example.com"
                            value={profileEmail}
                            onChange={(e) => setProfileEmail(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') addProfile();
                            }}
                          />
                          <Button
                            variant="secondary"
                            disabled={!profileLabel.trim() || !profileName.trim() || !profileEmail.trim()}
                            onClick={addProfile}
                          >
                            Add
                          </Button>
                        </div>
                      </div>
                    </div>
                  </SettingCard>

                  <SettingCard title="Advanced">
                    <div className="flex flex-col gap-3">
                      <Field label="Git executable (used by the built-in terminal)">
                        <Input value={settings.gitExecutable} onChange={(e) => settings.setGitExecutable(e.target.value)} />
                      </Field>
                      <Field label="SSH private key (optional — SSH agent is tried first)">
                        <div className="relative">
                          <KeyRound className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
                          <Input
                            className="pl-8"
                            value={settings.sshKeyPath}
                            onChange={(e) => settings.setSshKeyPath(e.target.value)}
                            placeholder="~/.ssh/id_ed25519"
                          />
                        </div>
                      </Field>
                    </div>
                  </SettingCard>
                </div>
              )}

              {section === 'accounts' && <AccountsTab />}

              {section === 'ai' && (
                <div className="flex flex-col gap-4">
                  <SettingCard
                    title="Provider"
                    description={
                      settings.ai.provider === 'cli'
                        ? 'Uses an AI CLI already installed on this machine — Claude Code, Codex, Gemini CLI or OpenCode — with its own login and quota. No API key needed.'
                        : 'Used for commit messages, diff explanations, conflict help and reviews. Local models via Ollama or LM Studio need no API key.'
                    }
                  >
                    <div className="flex flex-col gap-3">
                      <Select
                        value={settings.ai.provider}
                        onValueChange={(value) => {
                          const kind = value as AiProviderKind;
                          settings.setAi({
                            provider: kind,
                            model: AI_PROVIDER_PRESETS[kind].defaultModel,
                            baseUrl: '',
                          });
                        }}
                      >
                        <SelectTrigger>
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
                      {settings.ai.provider === 'cli' ? (
                        <>
                          <CliAgentPicker />
                          <Field label="Model override (optional — leave empty for the CLI's default)">
                            <Input
                              value={settings.ai.model}
                              onChange={(e) => settings.setAi({ model: e.target.value })}
                              placeholder="CLI default"
                            />
                          </Field>
                        </>
                      ) : (
                        <>
                          <Field label="Model">
                            <Input
                              value={settings.ai.model}
                              onChange={(e) => settings.setAi({ model: e.target.value })}
                              placeholder={preset.defaultModel}
                            />
                          </Field>
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
                          <Field label={`Base URL (optional — defaults to ${preset.defaultBaseUrl})`}>
                            <Input
                              value={settings.ai.baseUrl ?? ''}
                              onChange={(e) => settings.setAi({ baseUrl: e.target.value })}
                              placeholder={preset.defaultBaseUrl}
                            />
                          </Field>
                        </>
                      )}
                      <div className="flex justify-end">
                        <Button variant="secondary" onClick={() => void testAi()} disabled={testing}>
                          {testing ? <Spinner /> : <Wifi />}
                          Test connection
                        </Button>
                      </div>
                    </div>
                  </SettingCard>
                  <CommitStyleCard />
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
