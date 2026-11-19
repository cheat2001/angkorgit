import { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Spinner } from '@angkorgit/design-system';
import { ipc, type AccountRepository, type HostingAccount } from '@/core/ipc';

type RepositoryList =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; repositories: AccountRepository[] };

function AccountRepositories({
  account,
  onSelect,
}: {
  account: HostingAccount;
  onSelect: (url: string, account: HostingAccount) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [list, setList] = useState<RepositoryList>({ status: 'loading' });

  useEffect(() => {
    let current = true;
    void ipc.accountRepositories(account).then(
      (repositories) => {
        if (current) setList({ status: 'ready', repositories });
      },
      (error: unknown) => {
        if (!current) return;
        const message = (error as { message?: string } | null)?.message ?? String(error);
        setList({ status: 'error', message });
      },
    );
    return () => { current = false; };
  }, [account, attempt]);

  if (list.status === 'loading') {
    return <div role="status" className="flex items-center gap-2 px-2 py-1 text-sm text-muted"><Spinner /> Loading repositories…</div>;
  }
  if (list.status === 'error') {
    return (
      <div className="flex items-start gap-2 px-2 py-1">
        <p role="alert" className="min-w-0 flex-1 text-sm text-muted [overflow-wrap:anywhere]">{list.message}</p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setList({ status: 'loading' });
            setAttempt((value) => value + 1);
          }}
        >
          Retry
        </Button>
      </div>
    );
  }
  if (list.repositories.length === 0) {
    return <p role="status" className="px-2 py-1 text-sm text-muted">No repositories available to this account.</p>;
  }
  return (
    <Command label="Search repositories" className="overflow-hidden rounded-md border border-border bg-background">
      <Command.Input
        placeholder="Search repositories…"
        className="h-9 w-full border-b border-border-subtle bg-transparent px-2 text-sm text-foreground outline-none placeholder:text-faint focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary"
      />
      <Command.List label="Repositories" className="max-h-36 overflow-y-auto p-1">
        <Command.Empty className="px-2 py-1 text-sm text-muted">No matching repositories.</Command.Empty>
        {list.repositories.map((repository) => (
          <Command.Item
            key={repository.cloneUrl}
            value={repository.cloneUrl}
            keywords={[repository.fullName]}
            onSelect={() => onSelect(repository.cloneUrl, account)}
            className="cursor-pointer truncate rounded-sm px-2 py-1 text-sm text-foreground data-[selected=true]:bg-surface-raised"
            title={repository.fullName}
          >
            {repository.fullName}
          </Command.Item>
        ))}
      </Command.List>
    </Command>
  );
}

export function AccountRepositoryPicker({
  accounts,
  onSelect,
}: {
  accounts: HostingAccount[];
  onSelect: (url: string, account: HostingAccount) => void;
}) {
  const [selected, setSelected] = useState(accounts.length === 1 ? '0' : '');
  const account = selected === '' ? undefined : accounts[Number(selected)];
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-2">
      <Select value={selected} onValueChange={setSelected}>
        <SelectTrigger aria-label="Saved account">
          <SelectValue placeholder="Choose a saved account" />
        </SelectTrigger>
        <SelectContent className="w-[var(--radix-select-trigger-width)]">
          {accounts.map((account, index) => (
            <SelectItem key={`${account.host}/${account.username}`} value={String(index)}>
              <span className="block truncate">{account.username} on {account.host}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {account && <AccountRepositories key={selected} account={account} onSelect={onSelect} />}
    </div>
  );
}
