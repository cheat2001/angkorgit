import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Github,
  Gitlab,
  Globe,
  KeyRound,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Star,
  Trash2,
} from 'lucide-react';
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  cn,
} from '@angkorgit/design-system';
import { ipc, openExternal, type AccountCheckStatus, type HostingAccount } from '@/core/ipc';
import { timeAgo } from '@/shared/utils';
import { confirmDialog } from '@/components/confirm';
import { Field, SettingCard } from './SettingCard';

type ProviderKind = 'github' | 'gitlab' | 'gitlab-self' | 'bitbucket' | 'other';

interface ProviderPreset {
  label: string;
  defaultHost: string;
  hostEditable: boolean;
  tokenUrl: (host: string) => string | null;
  tokenHint: string;
  usernameHint: string;
}

const PROVIDERS: Record<ProviderKind, ProviderPreset> = {
  github: {
    label: 'GitHub',
    defaultHost: 'github.com',
    hostEditable: false,
    tokenUrl: () => 'https://github.com/settings/tokens/new?scopes=repo&description=AngKorGit',
    tokenHint: 'Personal access token with the "repo" scope',
    usernameHint: 'username (detected from the token)',
  },
  gitlab: {
    label: 'GitLab.com',
    defaultHost: 'gitlab.com',
    hostEditable: false,
    tokenUrl: () => 'https://gitlab.com/-/user_settings/personal_access_tokens',
    tokenHint: 'Personal access token with "read_repository" + "write_repository" scopes',
    usernameHint: 'username (detected from the token)',
  },
  'gitlab-self': {
    label: 'GitLab (self-hosted)',
    defaultHost: '',
    hostEditable: true,
    tokenUrl: (host) => (host ? `http://${host}/-/user_settings/personal_access_tokens` : null),
    tokenHint: 'Personal access token with "read_repository" + "write_repository" scopes',
    usernameHint: 'username (detected from the token)',
  },
  bitbucket: {
    label: 'Bitbucket',
    defaultHost: 'bitbucket.org',
    hostEditable: false,
    tokenUrl: () => 'https://id.atlassian.com/manage-profile/security/api-tokens',
    tokenHint: 'API token with read:repository:bitbucket + write:repository:bitbucket scopes',
    usernameHint: 'Atlassian account email (your Bitbucket username is detected)',
  },
  other: {
    label: 'Other host',
    defaultHost: '',
    hostEditable: true,
    tokenUrl: () => null,
    tokenHint: 'Token or password used for HTTPS git access',
    usernameHint: 'username',
  },
};

export function providerIcon(provider: string) {
  if (provider === 'github') return <Github className="size-4" />;
  if (provider.startsWith('gitlab')) return <Gitlab className="size-4" />;
  return <Globe className="size-4" />;
}

function accountKey(account: Pick<HostingAccount, 'host' | 'username'>): string {
  return `${account.host}:${account.username}`;
}

export function parseExpiry(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const iso = raw.includes(' UTC') ? `${raw.replace(' ', 'T').replace(' UTC', '')}Z` : raw;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysUntil(date: Date): number {
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000);
}

async function validateToken(
  provider: ProviderKind,
  host: string,
  identity: string,
  token: string,
): Promise<{ login: string } | null | 'unreachable'> {
  try {
    if (provider === 'bitbucket') {
      if (!identity) {
        throw new Error('enter your Atlassian account email so the token can be verified');
      }
      const res = await ipc.httpRequest({
        url: 'https://api.bitbucket.org/2.0/user',
        method: 'GET',
        headers: {
          authorization: `Basic ${btoa(`${identity}:${token}`)}`,
          'user-agent': 'AngKorGit',
        },
      });
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          `Bitbucket rejected these credentials (${res.status}) — check that this is your Atlassian account email and that the API token carries the read:repository:bitbucket scope`,
        );
      }
      if (res.status !== 200) throw new Error(`Bitbucket rejected the token (${res.status})`);
      return { login: (JSON.parse(res.body) as { username: string }).username };
    }
    if (provider === 'github') {
      const res = await ipc.httpRequest({
        url: 'https://api.github.com/user',
        method: 'GET',
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'user-agent': 'AngKorGit',
        },
      });
      if (res.status !== 200) throw new Error(`GitHub rejected the token (${res.status})`);
      return { login: (JSON.parse(res.body) as { login: string }).login };
    }
    if (provider === 'gitlab' || provider === 'gitlab-self') {
      for (const scheme of ['https', 'http']) {
        try {
          const res = await ipc.httpRequest({
            url: `${scheme}://${host}/api/v4/user`,
            method: 'GET',
            headers: { 'private-token': token, 'user-agent': 'AngKorGit' },
          });
          if (res.status === 200) {
            return { login: (JSON.parse(res.body) as { username: string }).username };
          }
          if (res.status === 401 || res.status === 403) {
            throw new Error(`GitLab rejected the token (${res.status})`);
          }
        } catch (error) {
          if ((error as Error).message?.includes('rejected')) throw error;
        }
      }
      return 'unreachable';
    }
    return null;
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

function AccountStatus({
  account,
  check,
}: {
  account: HostingAccount;
  check: AccountCheckStatus | 'checking' | undefined;
}) {
  if (check === 'checking') return <Spinner className="size-3.5" />;
  if (check === 'unreachable') {
    return <span className="text-xs text-muted">Could not check (offline?)</span>;
  }
  if (!account.verified) {
    if (!account.verifiedAt) {
      return <span className="text-xs text-faint">Not verified</span>;
    }
    return (
      <span className="flex items-center gap-1 text-xs text-danger">
        <AlertTriangle className="size-3.5" /> Token expired or revoked
      </span>
    );
  }
  const expiry = parseExpiry(account.expiresAt);
  if (expiry) {
    const days = daysUntil(expiry);
    if (days <= 0) {
      return (
        <span className="flex items-center gap-1 text-xs text-danger">
          <AlertTriangle className="size-3.5" /> Token expired
        </span>
      );
    }
    return (
      <span
        className={cn(
          'flex items-center gap-1 text-xs',
          days <= 14 ? 'text-primary' : 'text-success',
        )}
      >
        <CheckCircle2 className="size-3.5" /> expires in {days}d
      </span>
    );
  }
  return <CheckCircle2 className="size-3.5 text-success" />;
}

export function AccountsTab() {
  const [accounts, setAccounts] = useState<HostingAccount[]>([]);
  const [checks, setChecks] = useState<Record<string, AccountCheckStatus | 'checking'>>({});
  const [provider, setProvider] = useState<ProviderKind>('github');
  const [host, setHost] = useState(PROVIDERS.github.defaultHost);
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const tokenInputRef = useRef<HTMLInputElement>(null);

  const runChecks = async (list: HostingAccount[]) => {
    const eligible = list.filter(
      (account) =>
        account.provider !== 'other' && !(account.provider === 'bitbucket' && !account.email),
    );
    setChecks((c) => ({
      ...c,
      ...Object.fromEntries(eligible.map((account) => [accountKey(account), 'checking' as const])),
    }));
    await Promise.all(
      eligible.map(async (account) => {
        const key = accountKey(account);
        try {
          const result = await ipc.accountCheck(account.host, account.username);
          setChecks((c) => ({ ...c, [key]: result.status }));
          setAccounts(result.accounts);
        } catch {
          setChecks((c) => ({ ...c, [key]: 'unreachable' }));
        }
      }),
    );
  };

  useEffect(() => {
    let cancelled = false;
    void ipc
      .accountList()
      .then((list) => {
        if (cancelled) return;
        setAccounts(list);
        setLoading(false);
        void runChecks(list);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
        setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const preset = PROVIDERS[provider];

  const changeProvider = (kind: ProviderKind) => {
    setProvider(kind);
    setHost(PROVIDERS[kind].defaultHost);
  };

  const reconnect = (account: HostingAccount) => {
    const kind = (
      Object.keys(PROVIDERS) as ProviderKind[]
    ).find((k) => k === account.provider) ?? 'other';
    setProvider(kind);
    setHost(account.host);
    setUsername(kind === 'bitbucket' ? (account.email ?? '') : account.username);
    setToken('');
    tokenInputRef.current?.focus();
  };

  const connect = async () => {
    const cleanHost = host.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!cleanHost || !token.trim()) return;
    setBusy(true);
    try {
      let finalUsername = username.trim();
      let isVerified = false;
      const verified = await validateToken(provider, cleanHost, finalUsername, token.trim());
      if (verified === 'unreachable') {
        toast.warning(`${cleanHost} is unreachable right now — saving without verification`);
        if (!finalUsername) throw new Error('enter a username to save without verification');
      } else if (verified) {
        finalUsername = verified.login;
        isVerified = true;
      } else if (!finalUsername) {
        throw new Error('username is required for this provider');
      }

      const email = provider === 'bitbucket' ? username.trim() : null;
      const updated = await ipc.accountAdd(
        cleanHost,
        finalUsername,
        provider,
        token.trim(),
        isVerified,
        email,
      );
      setAccounts(updated);
      setToken('');
      setUsername('');
      setAdding(false);
      if (isVerified) toast.success(`Connected ${cleanHost} as ${finalUsername}`);
      else toast.warning(`Saved ${cleanHost} as ${finalUsername} — token not verified`);
      const added = updated.find((a) => a.host === cleanHost && a.username === finalUsername);
      if (added) void runChecks([added]);
    } catch (error) {
      toast.error(`Connect failed: ${(error as { message?: string }).message ?? error}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (account: HostingAccount) => {
    try {
      setAccounts(await ipc.accountRemove(account.host, account.username));
      toast.success(`Removed ${account.username} on ${account.host}`);
    } catch (error) {
      toast.error(`Remove failed: ${(error as { message?: string }).message ?? error}`);
    }
  };

  const makeDefault = async (account: HostingAccount) => {
    try {
      setAccounts(await ipc.accountSetDefault(account.host, account.username));
      toast.success(`${account.username} is now the default for ${account.host}`);
    } catch (error) {
      toast.error(`Could not set default: ${(error as { message?: string }).message ?? error}`);
    }
  };

  const hostCounts = accounts.reduce<Record<string, number>>((acc, a) => {
    acc[a.host] = (acc[a.host] ?? 0) + 1;
    return acc;
  }, {});

  const tokenPage = preset.tokenUrl(host.trim());
  const showForm = adding || (!loading && accounts.length === 0);

  const confirmRemove = async (account: HostingAccount) => {
    const ok = await confirmDialog({
      title: `Remove ${account.username} on ${account.host}?`,
      description:
        'The token is deleted from the system keychain. Pushes to this host fall back to your other accounts or the credential helper.',
      confirmLabel: 'Remove account',
      destructive: true,
    });
    if (ok) await remove(account);
  };

  return (
    <SettingCard
      title="Accounts"
      description="Used automatically when a remote's host matches — push and pull over HTTPS with no SSH setup. Several accounts per host are fine; one is the default and profiles can pick another."
      action={
        !showForm ? (
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" /> Add account
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-2">
        {loading && (
          <div className="flex flex-col gap-2">
            {[0, 1].map((row) => (
              <div key={row} className="flex items-center gap-3 rounded-lg border border-border-subtle p-3">
                <div className="size-8 animate-pulse rounded-md bg-surface-raised" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <div className="h-3.5 w-36 animate-pulse rounded bg-surface-raised" />
                  <div className="h-3 w-52 animate-pulse rounded bg-surface-raised" />
                </div>
              </div>
            ))}
          </div>
        )}
        {loadFailed && <p className="text-xs text-danger">Could not load accounts.</p>}

        {!loading &&
          accounts.map((account) => {
            const key = accountKey(account);
            const multi = (hostCounts[account.host] ?? 0) > 1;
            return (
              <div
                key={key}
                className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-raised/40 p-3"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface text-muted">
                  {providerIcon(account.provider)}
                </span>
                <div className="min-w-0 flex-1 leading-tight">
                  <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <span className="truncate">{account.username}</span>
                    <span className="truncate font-normal text-muted">@ {account.host}</span>
                    {multi && account.isDefault && <Badge tone="neutral">default</Badge>}
                  </p>
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-faint">
                    <AccountStatus account={account} check={checks[key]} />
                    <span>· token in the system keychain</span>
                    {account.verified && account.verifiedAt && <span>· checked {timeAgo(account.verifiedAt)}</span>}
                  </p>
                </div>
                {!account.verified && (
                  <Button variant="secondary" size="sm" onClick={() => reconnect(account)}>
                    <RefreshCw className="size-3.5" /> Reconnect
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`${account.username} on ${account.host} actions`}>
                      <MoreHorizontal className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {multi && !account.isDefault && (
                      <DropdownMenuItem onClick={() => void makeDefault(account)}>
                        <Star /> Make default for {account.host}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={() => reconnect(account)}>
                      <RefreshCw /> Reconnect with a new token…
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem destructive onClick={() => void confirmRemove(account)}>
                      <Trash2 /> Remove account…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}

        {showForm && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
            <p className="mb-3 flex items-center gap-2 text-xs font-medium text-foreground">
              <KeyRound className="size-3.5 text-primary" />
              {accounts.length === 0 ? 'Connect your first account' : 'Add account'}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Provider">
                <Select value={provider} onValueChange={(v) => changeProvider(v as ProviderKind)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PROVIDERS) as ProviderKind[]).map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {PROVIDERS[kind].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Host">
                <Input
                  placeholder="gitlab.example.com"
                  value={host}
                  disabled={!preset.hostEditable}
                  onChange={(e) => setHost(e.target.value)}
                  className="font-mono"
                />
              </Field>
              <Field
                label={provider === 'bitbucket' ? 'Atlassian account email' : 'Username'}
                hint={provider === 'bitbucket' ? 'Bitbucket username is detected' : provider === 'other' ? undefined : 'detected from the token'}
              >
                <Input
                  placeholder={provider === 'bitbucket' ? 'you@company.com' : 'optional'}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </Field>
              <Field
                label="Token"
                hint={
                  tokenPage ? (
                    <button
                      type="button"
                      className="flex items-center gap-1 text-primary hover:underline"
                      onClick={() => void openExternal(tokenPage)}
                    >
                      Create one on {preset.label} <ExternalLink className="size-3" />
                    </button>
                  ) : undefined
                }
              >
                <Input
                  ref={tokenInputRef}
                  type="password"
                  placeholder="Paste the token"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void connect();
                    if (e.key === 'Escape' && accounts.length > 0) setAdding(false);
                  }}
                />
              </Field>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-[11px] text-faint">{preset.tokenHint}</span>
              <span className="flex shrink-0 gap-2">
                {accounts.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
                    Cancel
                  </Button>
                )}
                <Button size="sm" onClick={() => void connect()} disabled={busy || !token.trim() || !host.trim()}>
                  {busy ? <Spinner className="text-primary-foreground" /> : null}
                  Connect
                </Button>
              </span>
            </div>
          </div>
        )}
      </div>
    </SettingCard>
  );
}
