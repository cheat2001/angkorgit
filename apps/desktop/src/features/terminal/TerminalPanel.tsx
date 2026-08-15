import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Button } from '@angkorgit/design-system';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { ipc, isTauri, listen } from '@/core/ipc';
import { useRepo } from '@/features/repository/store';
import { useUi } from '@/features/ui/store';

export function TerminalPanel() {
  const repoPath = useRepo((s) => s.repo?.path ?? null);
  const toggleTerminal = useUi((s) => s.toggleTerminal);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hostRef.current || !repoPath) return;

    const dark = document.documentElement.classList.contains('dark');
    const terminal = new Terminal({
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 12,
      cursorBlink: true,
      theme: dark
        ? { background: '#0D1220', foreground: '#E2E6EF', cursor: '#D97706' }
        : { background: '#FFFFFF', foreground: '#1A2233', cursor: '#D97706' },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(hostRef.current);
    fit.fit();

    let termId: number | null = null;
    let unlistenData: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;
    let disposed = false;

    if (!isTauri()) {
      terminal.writeln('AngKorGit demo terminal — PTY available in the desktop app.');
      terminal.write('$ ');
      terminal.onData((data) => {
        if (data === '\r') terminal.write('\r\n$ ');
        else if (data === '\x7f') terminal.write('\b \b');
        else terminal.write(data);
      });
    } else {
      void (async () => {
        const id = await ipc.termCreate(repoPath, terminal.cols, terminal.rows);
        if (disposed) {
          void ipc.termKill(id);
          return;
        }
        termId = id;
        const dataUnlisten = await listen(`term-data-${id}`, (payload) => {
          terminal.write((payload as { data: string }).data);
        });
        if (disposed) {
          dataUnlisten();
          return;
        }
        unlistenData = dataUnlisten;
        const exitUnlisten = await listen(`term-exit-${id}`, () => {
          terminal.writeln('\r\n[process exited]');
        });
        if (disposed) {
          exitUnlisten();
          return;
        }
        unlistenExit = exitUnlisten;
        terminal.onData((data) => void ipc.termWrite(id, data));
        terminal.onResize(({ cols, rows }) => void ipc.termResize(id, cols, rows));
      })();
    }

    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(hostRef.current);

    return () => {
      disposed = true;
      observer.disconnect();
      unlistenData?.();
      unlistenExit?.();
      if (termId !== null) void ipc.termKill(termId);
      terminal.dispose();
    };
  }, [repoPath]);

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex h-7 shrink-0 items-center border-b border-border-subtle px-3">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Terminal</span>
        <span className="ml-2 truncate font-mono text-[10px] text-faint">{repoPath}</span>
        <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="Close terminal" onClick={toggleTerminal}>
          <X className="size-3" />
        </Button>
      </div>
      <div ref={hostRef} className="terminal-host min-h-0 flex-1" />
    </div>
  );
}
