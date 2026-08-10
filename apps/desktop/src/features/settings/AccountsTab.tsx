import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, ExternalLink, Github, Gitlab, Globe, KeyRound, Trash2 } from 'lucide-react';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
} from '@angkorgit/design-system';
import { ipc, openExternal, type HostingAccount } from '@/core/ipc';

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

function providerIcon(provider: string) {
  if (provider === 'github') return <Github className="size-4" />;
  if (provider.startsWith('gitlab')) return <Gitlab className="size-4" />;
  return <Globe className="size-4" />;
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

export function AccountsTab() {
  const [accounts, setAccounts] = useState<HostingAccount[]>([]);
  const [provider, setProvider] = useState<ProviderKind>('github');
  const [host, setHost] = useState(PROVIDERS.github.defaultHost);
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void ipc.accountList().then(setAccounts);
  }, []);

  const preset = PROVIDERS[provider];

  const changeProvider = (kind: ProviderKind) => {
    setProvider(kind);
    setHost(PROVIDERS[kind].defaultHost);
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

      const updated = await ipc.accountAdd(
        cleanHost,
        finalUsername,
        provider,
        token.trim(),
        isVerified,
      );
      setAccounts(updated);
      setToken('');
      setUsername('');
      if (isVerified) toast.success(`Connected ${cleanHost} as ${finalUsername}`);
      else toast.warning(`Saved ${cleanHost} as ${finalUsername} — token not verified`);
    } catch (error) {
      toast.error(`Connect failed: ${(error as { message?: string }).message ?? error}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (accountHost: string) => {
    try {
      setAccounts(await ipc.accountRemove(accountHost));
      toast.success(`Removed ${accountHost}`);
    } catch (error) {
      toast.error(`Remove failed: ${(error as { message?: string }).message ?? error}`);
    }
  };

  const tokenPage = preset.tokenUrl(host.trim());

  return (
    <div className="flex flex-col gap-4">
      {accounts.length > 0 && (
        <div className="flex flex-col gap-1">
          {accounts.map((account) => (
            <div
              key={account.host}
              className="group flex items-center gap-3 rounded-lg border border-border p-3"
            >
              {providerIcon(account.provider)}
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-sm">
                  {account.host}
                  {account.verified && <CheckCircle2 className="size-3.5 text-success" />}
                </p>
                <p className="text-xs text-faint">
                  {account.username} · token in system keychain
                  {account.verified ? '' : ' · not verified'}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${account.host}`}
                className="opacity-0 group-hover:opacity-100"
                onClick={() => void remove(account.host)}
              >
                <Trash2 className="size-3.5 text-danger" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-border p-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <KeyRound className="size-4" /> Add account
        </p>
        <p className="mt-1 text-xs text-faint">
          Used automatically when a remote matches the host — push and pull over HTTPS, no SSH needed.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex gap-2">
            <Select value={provider} onValueChange={(v) => changeProvider(v as ProviderKind)}>
              <SelectTrigger className="w-44 shrink-0">
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
            <Input
              placeholder="host, e.g. gitlab-01.remotes.local"
              value={host}
              disabled={!preset.hostEditable}
              onChange={(e) => setHost(e.target.value)}
            />
          </div>
          <Input
            placeholder={preset.usernameHint}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <div className="flex gap-2">
            <Input
              type="password"
              placeholder={preset.tokenHint}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void connect();
              }}
            />
            <Button onClick={() => void connect()} disabled={busy || !token.trim() || !host.trim()}>
              {busy ? <Spinner className="text-primary-foreground" /> : null}
              Connect
            </Button>
          </div>
          {tokenPage && (
            <Button variant="ghost" size="sm" className="self-start" onClick={() => void openExternal(tokenPage)}>
              <ExternalLink /> Open {preset.label} to create a token
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
