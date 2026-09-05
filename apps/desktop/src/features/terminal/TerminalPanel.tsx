import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Button, Hint } from '@angkorgit/design-system';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { ipc, isTauri, listen } from '@/core/ipc';
import { useRepo } from '@/features/repository/store';
import { useSettings } from '@/features/settings/store';
import { useUi } from '@/features/ui/store';
import { killTerminalSession, sessions, type TerminalSession } from './sessions';
import { terminalThemeFromTokens } from './theme';

function newSession(): TerminalSession {
  const container = document.createElement('div');
  container.style.width = '100%';
  container.style.height = '100%';
  const terminal = new Terminal({
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 12,
    cursorBlink: true,
    scrollback: 5000,
    theme: terminalThemeFromTokens(),
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  return {
    terminal,
    fit,
    container,
    termId: null,
    unlisteners: [],
    killed: false,
    exited: false,
  };
}

function spawnShell(session: TerminalSession, repoPath: string): void {
  const { terminal } = session;
  if (!isTauri()) {
    terminal.writeln('AngKorGit demo terminal — PTY available in the desktop app.');
    terminal.write('$ ');
    terminal.onData((data) => {
      if (data === '\r') terminal.write('\r\n$ ');
      else if (data === '\x7f') terminal.write('\b \b');
      else terminal.write(data);
    });
    return;
  }
  void (async () => {
    try {
      const id = await ipc.termCreate(repoPath, terminal.cols, terminal.rows);
      if (session.killed) {
        void ipc.termKill(id);
        return;
      }
      session.termId = id;
      const dataUnlisten = await listen(`term-data-${id}`, (payload) => {
        terminal.write((payload as { data: string }).data);
      });
      if (session.killed) {
        dataUnlisten();
        return;
      }
      session.unlisteners.push(dataUnlisten);
      const exitUnlisten = await listen(`term-exit-${id}`, () => {
        session.exited = true;
        terminal.writeln('\r\n[process exited]');
      });
      if (session.killed) {
        exitUnlisten();
        return;
      }
      session.unlisteners.push(exitUnlisten);
      terminal.onData((data) => void ipc.termWrite(id, data));
      terminal.onResize(({ cols, rows }) => void ipc.termResize(id, cols, rows));
    } catch (error) {
      if (session.killed) return;
      session.exited = true;
      terminal.writeln(
        `\r\n[could not start shell: ${(error as { message?: string }).message ?? error}]`,
      );
    }
  })();
}

export function TerminalPanel() {
  const repoPath = useRepo((s) => s.repo?.path ?? null);
  const toggleTerminal = useUi((s) => s.toggleTerminal);
  const theme = useSettings((s) => s.theme);
  const accent = useSettings((s) => s.accent);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const next = terminalThemeFromTokens();
    for (const session of sessions.values()) session.terminal.options.theme = next;
  }, [theme, accent]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !repoPath) return;

    let session = sessions.get(repoPath);
    if (session?.exited) {
      killTerminalSession(repoPath);
      session = undefined;
    }
    const fresh = !session;
    if (!session) {
      session = newSession();
      sessions.set(repoPath, session);
    }
    host.appendChild(session.container);
    if (fresh) {
      session.terminal.open(session.container);
      session.fit.fit();
      spawnShell(session, repoPath);
    } else {
      session.terminal.options.theme = terminalThemeFromTokens();
      session.fit.fit();
      session.terminal.focus();
    }

    const attached = session;
    const observer = new ResizeObserver(() => attached.fit.fit());
    observer.observe(host);

    return () => {
      observer.disconnect();
      attached.container.remove();
    };
  }, [repoPath]);

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex h-7 shrink-0 items-center border-b border-border-subtle px-3">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Terminal</span>
        <span className="ml-2 min-w-0 flex-1 truncate font-mono text-[10px] text-faint">{repoPath}</span>
        <Hint label="Close terminal">
          <Button variant="ghost" size="icon-sm" className="ml-auto shrink-0" aria-label="Close terminal" onClick={toggleTerminal}>
            <X className="size-3" />
          </Button>
        </Hint>
      </div>
      <div ref={hostRef} className="terminal-host min-h-0 flex-1" />
    </div>
  );
}
