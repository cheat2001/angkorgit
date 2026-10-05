import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronsDownUp, ChevronsUpDown, FileText, X } from 'lucide-react';
import type { CommitFileInfo, FileDiff } from '@angkorgit/core';
import { Badge, Button, Hint, Kbd, Separator, Spinner, cn } from '@angkorgit/design-system';
import { ChangeMark, statusMeta } from '@/components/ChangeMark';
import { DirName } from '@/components/DirName';
import { ipc } from '@/core/ipc';
import { useRepo } from '@/features/repository/store';
import { useUi, type CenterDiffTarget } from '@/features/ui/store';
import { useShortcuts } from '@/shared/useShortcuts';
import { basename } from '@/shared/utils';
import { DiffViewer } from './DiffViewer';
import { DiffLayoutToggle, DiffViewControls, MenuNote } from './DiffViewControls';

const LARGE_FILE_LINES = 1500;
const LOAD_AHEAD = '1200px 0px';
const MAX_PARALLEL = 4;
const LINE_ESTIMATE = 20;
const SECTION_GAP = 12;

interface Loaded {
  diff: FileDiff | null;
  error: string | null;
}

const changedLines = (file: CommitFileInfo) => file.additions + file.deletions;
const isLarge = (file: CommitFileInfo) => changedLines(file) > LARGE_FILE_LINES;
const estimateHeight = (file: CommitFileInfo) =>
  file.isBinary || file.isImage ? 120 : Math.min(changedLines(file) * LINE_ESTIMATE + 80, 6000);

export function AllChangesView({ target }: { target: CenterDiffTarget & { oid: string } }) {
  const repoPath = useRepo((s) => s.repo?.path ?? '');
  const closeCenterDiff = useUi((s) => s.closeCenterDiff);
  const openCenterDiff = useUi((s) => s.openCenterDiff);
  const setDiffLayout = useUi((s) => s.setDiffLayout);
  const ignoreWhitespace = useUi((s) => s.ignoreWhitespace);
  const fullFileDiff = useUi((s) => s.fullFileDiff);
  const diffView = useUi((s) => s.diffView);
  const oid = target.oid;

  const [files, setFiles] = useState<CommitFileInfo[] | null>(null);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<string>(target.path);

  const scrollRef = useRef<HTMLDivElement>(null);
  const sections = useRef(new Map<string, HTMLElement>());
  const heights = useRef(new Map<HTMLElement, number>());
  const visible = useRef(new Set<string>());
  const queue = useRef<string[]>([]);
  const inflight = useRef(new Set<string>());
  const generation = useRef(0);
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  const syncedFromScroll = useRef<string | null>(null);
  const userScrolling = useRef(false);

  useEffect(() => {
    if (!repoPath) return;
    let cancelled = false;
    setFiles(null);
    setFilesError(null);
    void ipc
      .commitFiles(repoPath, oid)
      .then((list) => {
        if (cancelled) return;
        setFiles(list);
        setCollapsed(new Set(list.filter(isLarge).map((f) => f.path)));
      })
      .catch((error) => {
        if (!cancelled) setFilesError(String((error as { message?: string }).message ?? error));
      });
    return () => {
      cancelled = true;
    };
  }, [repoPath, oid]);

  const fileByPath = useMemo(() => new Map((files ?? []).map((f) => [f.path, f])), [files]);

  const pump = useCallback(() => {
    while (inflight.current.size < MAX_PARALLEL && queue.current.length > 0) {
      const path = queue.current.shift()!;
      const file = fileByPath.get(path);
      if (!file || loadedRef.current[path] || inflight.current.has(path)) continue;
      const gen = generation.current;
      inflight.current.add(path);
      void ipc
        .commitFileDiff(
          repoPath,
          file.sourceOid ?? oid,
          path,
          file.oldPath,
          fullFileDiff ? 10_000_000 : undefined,
          ignoreWhitespace,
        )
        .then((diff) => {
          if (gen !== generation.current) return;
          const untouched =
            diff.hunks.length === 0 && diff.additions === 0 && diff.deletions === 0 && !diff.isBinary && !diff.isImage;
          setLoaded((prev) => ({ ...prev, [path]: { diff: untouched ? null : diff, error: null } }));
        })
        .catch((error) => {
          if (gen !== generation.current) return;
          setLoaded((prev) => ({
            ...prev,
            [path]: { diff: null, error: String((error as { message?: string }).message ?? error) },
          }));
        })
        .finally(() => {
          if (gen !== generation.current) return;
          inflight.current.delete(path);
          pump();
        });
    }
  }, [fileByPath, repoPath, oid, fullFileDiff, ignoreWhitespace]);

  const request = useCallback(
    (path: string) => {
      if (collapsedRef.current.has(path) || loadedRef.current[path] || inflight.current.has(path)) return;
      if (!queue.current.includes(path)) queue.current.push(path);
      pump();
    },
    [pump],
  );

  useEffect(() => {
    generation.current++;
    queue.current = [];
    inflight.current.clear();
    setLoaded({});
    loadedRef.current = {};
    for (const path of visible.current) request(path);
  }, [repoPath, oid, fullFileDiff, ignoreWhitespace, request]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !files) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const path = (entry.target as HTMLElement).dataset.filePath;
          if (!path) continue;
          if (entry.isIntersecting) {
            visible.current.add(path);
            request(path);
          } else {
            visible.current.delete(path);
          }
        }
      },
      { root, rootMargin: LOAD_AHEAD },
    );
    for (const el of sections.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [files, request]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !files) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const next = el.offsetHeight;
        const prev = heights.current.get(el);
        heights.current.set(el, next);
        if (prev === undefined || prev === next) continue;
        if (el.offsetTop + prev <= root.scrollTop) root.scrollTop += next - prev;
      }
    });
    for (const el of sections.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [files]);

  useLayoutEffect(() => {
    if (!files) return;
    if (syncedFromScroll.current === target.path) return;
    const root = scrollRef.current;
    const el = sections.current.get(target.path);
    if (!root || !el) return;
    userScrolling.current = false;
    root.scrollTop = el.offsetTop;
    setActive(target.path);
  }, [files, target.path]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const markUser = () => {
      userScrolling.current = true;
    };
    root.addEventListener('wheel', markUser, { passive: true });
    root.addEventListener('touchmove', markUser, { passive: true });
    root.addEventListener('pointerdown', markUser);
    root.addEventListener('keydown', markUser);
    return () => {
      root.removeEventListener('wheel', markUser);
      root.removeEventListener('touchmove', markUser);
      root.removeEventListener('pointerdown', markUser);
      root.removeEventListener('keydown', markUser);
    };
  }, []);

  const frame = useRef<number | null>(null);
  const onScroll = () => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const root = scrollRef.current;
      if (!root || !files || !userScrolling.current) return;
      let current = files[0]?.path ?? null;
      for (const file of files) {
        const el = sections.current.get(file.path);
        if (!el) continue;
        if (el.offsetTop <= root.scrollTop + SECTION_GAP) current = file.path;
        else break;
      }
      if (!current || current === active) return;
      setActive(current);
      syncedFromScroll.current = current;
      const file = fileByPath.get(current);
      openCenterDiff({ path: current, oid, oldPath: file?.oldPath ?? null });
    });
  };

  const index = files ? files.findIndex((f) => f.path === active) : -1;
  const goFile = (direction: 1 | -1) => {
    if (!files || index < 0) return;
    const next = files[index + direction];
    if (!next) return;
    syncedFromScroll.current = null;
    openCenterDiff({ path: next.path, oid, oldPath: next.oldPath });
  };
  const goFileRef = useRef(goFile);
  goFileRef.current = goFile;
  useShortcuts(
    useMemo(
      () => [
        { combo: '[', handler: () => goFileRef.current(-1), skipInInput: true },
        { combo: ']', handler: () => goFileRef.current(1), skipInInput: true },
      ],
      [],
    ),
  );

  const toggle = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
        collapsedRef.current = next;
        queueMicrotask(() => request(path));
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const allCollapsed = !!files && files.length > 0 && files.every((f) => collapsed.has(f.path));
  const toggleAll = () => {
    if (!files) return;
    if (allCollapsed) {
      const next = new Set(files.filter(isLarge).map((f) => f.path));
      collapsedRef.current = next;
      setCollapsed(next);
      queueMicrotask(() => {
        for (const path of visible.current) request(path);
      });
    } else {
      setCollapsed(new Set(files.map((f) => f.path)));
    }
  };

  const openInFileView = (file: CommitFileInfo) => {
    setDiffLayout('file');
    openCenterDiff({ path: file.path, oid: file.sourceOid ?? oid, oldPath: file.oldPath });
  };

  const totals = useMemo(
    () =>
      (files ?? []).reduce(
        (sum, f) => ({ additions: sum.additions + f.additions, deletions: sum.deletions + f.deletions }),
        { additions: 0, deletions: 0 },
      ),
    [files],
  );

  return (
    <motion.section
      className="flex h-full flex-col bg-background"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      aria-label={`All changes in ${oid.slice(0, 8)}`}
      data-all-changes
    >
      <div className="flex h-10 shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap border-b border-border-subtle bg-surface px-3">
        <Hint
          label={
            <span className="flex items-center gap-1">
              Back to graph <Kbd>Esc</Kbd>
            </span>
          }
        >
          <Button variant="ghost" size="icon-sm" aria-label="Close diff" onClick={closeCenterDiff}>
            <X className="size-4" />
          </Button>
        </Hint>
        <span className="text-xs font-medium">Changes</span>
        <Badge tone="neutral" className="font-mono">
          {oid.slice(0, 8)}
        </Badge>
        {files && (
          <span className="shrink-0 text-xs text-muted">
            {files.length === 1 ? '1 file' : `${files.length} files`}{' '}
            <span className="text-success">+{totals.additions}</span>{' '}
            <span className="text-danger">−{totals.deletions}</span>
          </span>
        )}
        <span className="flex-1" />
        <DiffLayoutToggle />
        <DiffViewControls
          notes={
            diffView === 'split' ? (
              <MenuNote>Side-by-side always wraps on the all-files page so both halves stay aligned.</MenuNote>
            ) : undefined
          }
        />
        <Hint label={allCollapsed ? 'Expand all files' : 'Collapse all files'}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={allCollapsed ? 'Expand all files' : 'Collapse all files'}
            disabled={!files || files.length === 0}
            onClick={toggleAll}
          >
            {allCollapsed ? <ChevronsUpDown className="size-3.5" /> : <ChevronsDownUp className="size-3.5" />}
          </Button>
        </Hint>
        {files && files.length > 1 && (
          <>
            <Separator orientation="vertical" className="mx-1 h-4" />
            <Hint
              label={
                <span className="flex items-center gap-1">
                  Previous file <Kbd>[</Kbd>
                </span>
              }
            >
              <Button variant="ghost" size="icon-sm" aria-label="Previous file" disabled={index <= 0} onClick={() => goFile(-1)}>
                <ChevronLeft className="size-4" />
              </Button>
            </Hint>
            <span className="text-[10px] tabular-nums text-faint">
              {index + 1} of {files.length}
            </span>
            <Hint
              label={
                <span className="flex items-center gap-1">
                  Next file <Kbd>]</Kbd>
                </span>
              }
            >
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Next file"
                disabled={index < 0 || index >= files.length - 1}
                onClick={() => goFile(1)}
              >
                <ChevronRight className="size-4" />
              </Button>
            </Hint>
          </>
        )}
      </div>

      <div ref={scrollRef} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-y-auto px-3 pb-6" data-all-changes-scroller>
        {filesError ? (
          <p className="py-16 text-center text-sm text-danger [overflow-wrap:anywhere]">
            Could not list the changed files: {filesError}
          </p>
        ) : !files ? (
          <div className="flex h-full items-center justify-center">
            <Spinner className="size-5" />
          </div>
        ) : files.length === 0 ? (
          <p className="py-16 text-center text-sm text-faint">This commit changes no files.</p>
        ) : (
          files.map((file) => {
            const meta = statusMeta[file.status];
            const isCollapsed = collapsed.has(file.path);
            const entry = loaded[file.path];
            const isActive = file.path === active;
            return (
              <section
                key={file.path}
                ref={(el) => {
                  if (el) sections.current.set(file.path, el);
                  else sections.current.delete(file.path);
                }}
                data-file-path={file.path}
                data-file-section={isCollapsed ? 'collapsed' : 'open'}
                className="mt-3 rounded-lg border border-border-subtle bg-surface"
              >
                <header
                  className={cn(
                    'sticky top-0 z-10 flex h-9 items-center gap-2 rounded-t-lg border-b bg-surface px-2',
                    isCollapsed ? 'rounded-b-lg border-transparent' : 'border-border-subtle',
                    isActive && 'shadow-[inset_2px_0_0_hsl(var(--primary))]',
                  )}
                >
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={isCollapsed ? `Expand ${file.path}` : `Collapse ${file.path}`}
                    aria-expanded={!isCollapsed}
                    onClick={() => toggle(file.path)}
                  >
                    <ChevronDown className={cn('size-3.5 transition-transform', isCollapsed && '-rotate-90')} />
                  </Button>
                  <ChangeMark tone={meta.tone} title={meta.label}>
                    {meta.mark}
                  </ChangeMark>
                  <span className="flex min-w-0 flex-1 items-baseline gap-1.5 text-xs" title={file.path}>
                    <span className="max-w-full shrink-0 truncate font-medium">{basename(file.path)}</span>
                    <DirName path={file.path} className="text-[11px]" />
                    {file.oldPath && file.oldPath !== file.path && (
                      <span className="shrink-0 truncate text-[11px] text-faint">from {file.oldPath}</span>
                    )}
                  </span>
                  {file.additions > 0 && <span className="shrink-0 font-mono text-[11px] text-success">+{file.additions}</span>}
                  {file.deletions > 0 && <span className="shrink-0 font-mono text-[11px] text-danger">−{file.deletions}</span>}
                  <Hint label="Open in file view">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Open ${file.path} in file view`}
                      onClick={() => openInFileView(file)}
                    >
                      <FileText className="size-3.5" />
                    </Button>
                  </Hint>
                </header>
                {isCollapsed ? (
                  isLarge(file) && (
                    <div className="flex items-center gap-3 rounded-b-lg border-t border-border-subtle px-4 py-3 text-xs text-muted">
                      <span className="flex-1">
                        Large diff, {changedLines(file).toLocaleString()} changed lines. Collapsed so the page stays fast.
                      </span>
                      <Button variant="secondary" size="sm" onClick={() => toggle(file.path)}>
                        Show diff
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => openInFileView(file)}>
                        Open in file view
                      </Button>
                    </div>
                  )
                ) : !entry ? (
                  <div className="flex items-center justify-center" style={{ height: estimateHeight(file) }}>
                    <Spinner className="size-4 text-faint" />
                  </div>
                ) : entry.error ? (
                  <div className="flex items-center gap-3 px-4 py-4 text-xs">
                    <span className="flex-1 text-danger [overflow-wrap:anywhere]">Could not load this diff: {entry.error}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setLoaded((prev) => {
                          const next = { ...prev };
                          delete next[file.path];
                          loadedRef.current = next;
                          return next;
                        });
                        queueMicrotask(() => request(file.path));
                      }}
                    >
                      Retry
                    </Button>
                  </div>
                ) : !entry.diff ? (
                  <p className="py-6 text-center text-xs text-faint">
                    {ignoreWhitespace ? 'Only whitespace changed in this file' : 'No text changes'}
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-b-lg" data-file-diff>
                    <DiffViewer
                      diff={entry.diff}
                      stacked
                      emptyLabel={ignoreWhitespace ? 'Only whitespace changed in this file' : undefined}
                    />
                  </div>
                )}
              </section>
            );
          })
        )}
      </div>
    </motion.section>
  );
}
