import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Check,
  Github,
  KeyRound,
  Trash2,
  UserRound,
  UsersRound,
  Minus,
  Moon,
  Palette,
  Plus,
  Sparkles,
  Sun,
  User,
  Keyboard,
  Wifi,
} from 'lucide-react';
import { AI_PROVIDER_PRESETS, type AiProviderKind } from '@angkorgit/core';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Kbd,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Spinner,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
} from '@angkorgit/design-system';
import { ipc } from '@/core/ipc';
import { useRepo } from '@/features/repository/store';
import { useUi } from '@/features/ui/store';
import { useSettings, ZOOM_MAX, ZOOM_MIN } from './store';
import { AccountsTab } from './AccountsTab';
import { getAiProvider } from '@/features/ai/client';
import { modKey } from '@/shared/utils';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

const SHORTCUTS: Array<[string, string[]]> = [
  ['Command palette', ['mod', 'K']],
  ['Toggle terminal', ['mod', '`']],
  ['Refresh repository', ['mod', 'R']],
  ['Settings', ['mod', ',']],
  ['Commit (in message box)', ['mod', '⏎']],
  ['Zoom in / out', ['mod', '+ / −']],
  ['Reset zoom', ['mod', '0']],
  ['Toggle sidebar', ['mod', 'B']],
  ['Close diff view', ['Esc']],
];

export function SettingsDialog() {
  const repo = useRepo((s) => s.repo);
  const { dialog, closeDialog } = useUi();
  const open = dialog === 'settings';
  const settings = useSettings();

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
      // Repo-local on purpose: never rewrites the shared global gitconfig.
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

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeDialog()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="appearance">
          <TabsList className="mb-4">
            <TabsTrigger value="appearance">
              <Palette className="size-3.5" /> Appearance
            </TabsTrigger>
            <TabsTrigger value="git">
              <User className="size-3.5" /> Git
            </TabsTrigger>
            <TabsTrigger value="accounts">
              <Github className="size-3.5" /> Accounts
            </TabsTrigger>
            <TabsTrigger value="ai">
              <Sparkles className="size-3.5" /> AI
            </TabsTrigger>
            <TabsTrigger value="shortcuts">
              <Keyboard className="size-3.5" /> Shortcuts
            </TabsTrigger>
          </TabsList>

          <TabsContent value="appearance" className="flex flex-col gap-4">
            <div className="flex gap-2">
              {(['dark', 'light'] as const).map((theme) => (
                <button
                  key={theme}
                  onClick={() => settings.setTheme(theme)}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-2 rounded-lg border p-4 text-sm transition-colors',
                    settings.theme === theme
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border hover:bg-surface-raised',
                  )}
                >
                  {theme === 'dark' ? <Moon className="size-4" /> : <Sun className="size-4" />}
                  {theme === 'dark' ? 'Dark' : 'Light'}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="text-sm">Zoom</p>
                <p className="text-xs text-faint">
                  Also <Kbd>{modKey()}</Kbd> <Kbd>+</Kbd> / <Kbd>{modKey()}</Kbd> <Kbd>−</Kbd> anywhere
                </p>
              </div>
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
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="text-sm">Reduce motion</p>
                <p className="text-xs text-faint">Minimize animations across the app</p>
              </div>
              <Switch checked={settings.reduceMotion} onCheckedChange={settings.setReduceMotion} />
            </div>
          </TabsContent>

          <TabsContent value="git" className="flex flex-col gap-4">
            <Field label="User name">
              <Input value={gitName} onChange={(e) => setGitName(e.target.value)} placeholder="Your Name" />
            </Field>
            <Field label="Email">
              <Input value={gitEmail} onChange={(e) => setGitEmail(e.target.value)} placeholder="you@example.com" />
            </Field>
            <p className="text-xs text-faint">
              {repo ? `Saved to this repository's .git/config` : 'Saved to your global git config'}
            </p>
            <Separator />
            <div className="rounded-lg border border-border p-3">
              <p className="flex items-center gap-2 text-sm font-medium">
                <UsersRound className="size-4" /> Identity profiles
              </p>
              <p className="mt-1 text-xs text-faint">
                Save your work and personal identities, then switch per repository — applied to that
                repo's local config only, so other tools can't override it.
              </p>
              <div className="mt-3 flex flex-col gap-1.5">
                {settings.profiles.map((profile) => {
                  const active = profile.email === gitEmail && profile.name === gitName;
                  return (
                    <div
                      key={profile.id}
                      className={cn(
                        'group flex items-center gap-2 rounded-md border p-2',
                        active ? 'border-primary/50 bg-primary/10' : 'border-border-subtle',
                      )}
                    >
                      <UserRound className={cn('size-4 shrink-0', active ? 'text-primary' : 'text-muted')} />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 text-sm">
                          {profile.label}
                          {active && <Check className="size-3.5 text-primary" />}
                        </p>
                        <p className="truncate text-xs text-faint">
                          {profile.name} · {profile.email}
                        </p>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={active}
                        onClick={() => void applyProfile(profile.name, profile.email, profile.label)}
                      >
                        {active ? 'Active' : repo ? 'Use for this repo' : 'Use'}
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
                <div className="mt-1 flex flex-col gap-2 rounded-md border border-dashed border-border p-2">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Label, e.g. Work"
                      value={profileLabel}
                      onChange={(e) => setProfileLabel(e.target.value)}
                      className="w-32 shrink-0"
                    />
                    <Input
                      placeholder="Name"
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                    />
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
            </div>
            <Separator />
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
            <div className="flex justify-end">
              <Button onClick={() => void saveIdentity()}>Save identity</Button>
            </div>
          </TabsContent>

          <TabsContent value="accounts">
            <AccountsTab />
          </TabsContent>

          <TabsContent value="ai" className="flex flex-col gap-4">
            <Field label="Provider">
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
            </Field>
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
            <div className="flex items-center justify-between">
              <p className="text-xs text-faint">
                Used for commit messages, diff explanations, conflict help and reviews.
              </p>
              <Button variant="secondary" onClick={() => void testAi()} disabled={testing}>
                {testing ? <Spinner /> : <Wifi />}
                Test connection
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="shortcuts">
            <div className="flex flex-col">
              {SHORTCUTS.map(([label, keys]) => (
                <div key={label} className="flex items-center justify-between border-b border-border-subtle py-2 last:border-0">
                  <span className="text-sm">{label}</span>
                  <span className="flex items-center gap-1">
                    {keys.map((key) => (
                      <Kbd key={key}>{key === 'mod' ? modKey() : key}</Kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
