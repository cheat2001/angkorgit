import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Command } from 'cmdk';
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Spinner } from '@angkorgit/design-system';
import type { AccountRepositoryPage } from '@angkorgit/core';
import { ipc, type HostingAccount } from '@/core/ipc';

type LoadMode = 'open' | 'refresh' | 'more';

interface RepositoryList extends AccountRepositoryPage {
  pending: boolean;
  loaded: boolean;
  attemptedAt: number;
  error?: { message: string; retry: LoadMode };
}

const emptyPage: AccountRepositoryPage = { repositories: [], next: null, skipped: 0 };
const cacheDuration = 5 * 60_000;

function accountKey(account: HostingAccount): string {
  return JSON.stringify([account.provider, account.host, account.username, account.verifiedAt]);
}

export function useAccountRepositoryPages() {
  const lists = useRef(new Map<string, RepositoryList>());
  const [, update] = useReducer((version: number) => version + 1, 0);
  const load = useCallback(async (account: HostingAccount, mode: LoadMode) => {
    const key = accountKey(account);
    const previous = lists.current.get(key);
    const now = Date.now();
    if (previous?.pending || (mode === 'open' && previous && now - previous.attemptedAt < cacheDuration)) return;
    if (mode === 'more' && !previous?.next) return;

    const pending: RepositoryList = {
      ...(previous ?? emptyPage),
      loaded: previous?.loaded ?? false,
      pending: true,
      attemptedAt: now,
      error: undefined,
    };
    lists.current.set(key, pending);
    update();
    try {
      const page = await ipc.accountRepositories(account, mode === 'more' ? previous?.next : null);
      const repositories = new Map(
        (mode === 'more' ? pending.repositories : []).map((repository) => [repository.cloneUrl, repository]),
      );
      for (const repository of page.repositories) repositories.set(repository.cloneUrl, repository);
      lists.current.set(key, {
        ...page,
        repositories: [...repositories.values()],
        skipped: page.skipped + (mode === 'more' ? pending.skipped : 0),
        loaded: true,
        pending: false,
        attemptedAt: now,
      });
    } catch (error) {
      const message = (error as { message?: string } | null)?.message ?? String(error);
      lists.current.set(key, {
        ...pending,
        pending: false,
        error: { message, retry: mode === 'open' ? 'refresh' : mode },
      });
    }
    update();
  }, []);
  return { lists: lists.current, load };
}

type RepositoryPages = ReturnType<typeof useAccountRepositoryPages>;

function AccountRepositories({
  account,
  active,
  pages,
  onSelect,
}: {
  account: HostingAccount;
  active: boolean;
  pages: RepositoryPages;
  onSelect: (url: string, account: HostingAccount) => void;
}) {
  const { load, lists } = pages;
  const list = lists.get(accountKey(account));
  const retry = list?.error?.retry;
  useEffect(() => {
    if (active) void load(account, 'open');
  }, [account, active, load]);

  return (
    <>
      {!!list?.repositories.length && (
        <Command label="Search repositories" className="overflow-hidden rounded-md border border-border bg-background">
          <Command.Input
            placeholder="Search repositories…"
            className="h-9 w-full border-b border-border-subtle bg-transparent px-2 text-sm text-foreground outline-none placeholder:text-faint focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary"
          />
          <Command.List label="Repositories" className="max-h-36 overflow-y-auto p-1">
            <Command.Empty className="px-2 py-1 text-sm text-muted">
              {list.next ? 'No matches in the loaded repositories.' : 'No matching repositories.'}
            </Command.Empty>
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
      )}
      {(!list || list.pending) && (
        <div role="status" className="flex items-center gap-2 px-2 py-1 text-sm text-muted">
          <Spinner /> Loading repositories…
        </div>
      )}
      {!!list?.skipped && (
        <p role="status" className="px-2 py-1 text-sm text-muted">
          {list.skipped === 1
            ? 'One repository had an invalid clone address.'
            : `${list.skipped} repositories had invalid clone addresses.`}
        </p>
      )}
      {list?.loaded && !list.repositories.length && !list.skipped && !list.pending && !list.error && (
        <p role="status" className="px-2 py-1 text-sm text-muted">
          {list.next ? 'No repositories on this page.' : 'No repositories available to this account.'}
        </p>
      )}
      {list?.error && (
        <p role="alert" className="px-2 py-1 text-sm text-muted [overflow-wrap:anywhere]">{list.error.message}</p>
      )}
      {list && (list.loaded || list.error) && (
        <div className="flex flex-wrap gap-2">
          {retry ? (
            <Button variant="secondary" size="sm" onClick={() => void load(account, retry)}>
              Retry
            </Button>
          ) : list.next && (
            <Button variant="secondary" size="sm" disabled={list.pending} onClick={() => void load(account, 'more')}>
              Load more
            </Button>
          )}
          {list.loaded && (
            <Button variant="ghost" size="sm" disabled={list.pending} onClick={() => void load(account, 'refresh')}>
              Refresh
            </Button>
          )}
        </div>
      )}
    </>
  );
}

export function AccountRepositoryPicker({
  accounts,
  active,
  pages,
  onSelect,
}: {
  accounts: HostingAccount[];
  active: boolean;
  pages: RepositoryPages;
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
            <SelectItem key={accountKey(account)} value={String(index)}>
              <span className="block truncate">{account.username} on {account.host}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {account && <AccountRepositories key={selected} account={account} active={active} pages={pages} onSelect={onSelect} />}
    </div>
  );
}
