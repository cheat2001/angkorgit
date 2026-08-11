import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { Check, ChevronDown, ChevronUp, Pencil, RotateCcw, Sparkles, X } from 'lucide-react';
import {
  aiCapabilities,
  parseConflicts,
  serializeResolution,
  type Block,
  type ConflictBlock,
} from '@angkorgit/core';
import { Badge, Button, Checkbox, Hint, Spinner, cn } from '@angkorgit/design-system';
import { ipc } from '@/core/ipc';
import { useRepo } from '@/features/repository/store';
import { useUi } from '@/features/ui/store';
import { aiConfigured, getAiProvider } from '@/features/ai/client';
import { confirmDialog } from '@/components/confirm';

type Side = 'current' | 'incoming';

interface Pick {
  side: Side;
  line: number;
}

const EMPTY_SIDE = -1;

function sideLabel(block: ConflictBlock, side: Side, headBranch: string | null): string {
  const raw = side === 'current' ? block.currentLabel : block.incomingLabel;
  if (side === 'current' && (raw === 'HEAD' || raw === '') && headBranch) return headBranch;
  return raw || (side === 'current' ? 'current' : 'incoming');
}

export function ConflictResolver({ file, onResolved }: { file: string; onResolved: () => Promise<void> }) {
  const repo = useRepo((s) => s.repo);
  const openConflict = useUi((s) => s.openConflict);
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [picks, setPicks] = useState<Map<number, Pick[]>>(new Map());
  const [manualText, setManualText] = useState<string | null>(null);
  const [activeConflict, setActiveConflict] = useState(0);
  const [saving, setSaving] = useState(false);
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const blockRefs = useRef(new Map<number, HTMLDivElement>());

  const path = repo?.path ?? '';

  useEffect(() => {
    let cancelled = false;
    void ipc
      .conflictRead(path, file)
      .then((cf) => {
        if (cancelled) return;
        setBlocks(parseConflicts(cf.content));
        setPicks(new Map());
        setManualText(null);
      })
      .catch((error) => {
        toast.error(`Could not read ${file}: ${(error as { message?: string }).message ?? error}`);
        openConflict(null);
      });
    return () => {
      cancelled = true;
    };
  }, [path, file, openConflict]);

  const conflictIndices = useMemo(
    () => (blocks ? blocks.flatMap((b, i) => (b.kind === 'conflict' ? [i] : [])) : []),
    [blocks],
  );
  const total = conflictIndices.length;
  const resolvedCount = useMemo(
    () => conflictIndices.filter((i) => (picks.get(i)?.length ?? 0) > 0).length,
    [conflictIndices, picks],
  );

  const firstConflict = blocks?.find((b): b is ConflictBlock => b.kind === 'conflict');
  const headBranch = repo?.headBranch ?? null;
  const aLabel = firstConflict ? sideLabel(firstConflict, 'current', headBranch) : 'current';
  const bLabel = firstConflict ? sideLabel(firstConflict, 'incoming', headBranch) : 'incoming';

  const pickedLines = (block: ConflictBlock, blockPicks: Pick[]): string[] =>
    blockPicks
      .filter((p) => p.line !== EMPTY_SIDE)
      .map((p) => (p.side === 'current' ? block.current : block.incoming)[p.line]);

  const buildResult = (): string => {
    if (!blocks) return '';
    const manualEdits = new Map<number, string[]>();
    const resolved = blocks.map((b, i) => {
      if (b.kind !== 'conflict') return b;
      const blockPicks = picks.get(i) ?? [];
      if (blockPicks.length === 0) return b;
      manualEdits.set(i, pickedLines(b, blockPicks));
      return { ...b, resolution: 'manual' as const };
    });
    return serializeResolution(resolved, manualEdits);
  };

  const manualHasMarkers = manualText !== null && manualText.includes('<<<<<<<');
  const canSave = manualText !== null ? !manualHasMarkers : blocks !== null && resolvedCount === total;

  const guardManual = async (): Promise<boolean> => {
    if (manualText === null) return true;
    const ok = await confirmDialog({
      title: 'Replace manual edits?',
      description: 'Your hand-written Output will be replaced by the resolution built from the checkboxes.',
      confirmLabel: 'Replace',
      destructive: true,
    });
    if (ok) setManualText(null);
    return ok;
  };

  const isPicked = (index: number, side: Side, line: number) =>
    (picks.get(index) ?? []).some((p) => p.side === side && p.line === line);

  const toggleLine = async (index: number, side: Side, line: number) => {
    if (!(await guardManual())) return;
    setPicks((prev) => {
      const next = new Map(prev);
      const blockPicks = [...(next.get(index) ?? [])];
      const at = blockPicks.findIndex((p) => p.side === side && p.line === line);
      if (at >= 0) blockPicks.splice(at, 1);
      else blockPicks.push({ side, line });
      next.set(index, blockPicks);
      return next;
    });
  };

  const sideFullyPicked = (index: number, side: Side): boolean => {
    if (!blocks) return false;
    const block = blocks[index] as ConflictBlock;
    const lines = side === 'current' ? block.current : block.incoming;
    const blockPicks = picks.get(index) ?? [];
    if (lines.length === 0) return blockPicks.some((p) => p.side === side && p.line === EMPTY_SIDE);
    return lines.every((_, li) => blockPicks.some((p) => p.side === side && p.line === li));
  };

  const allOfSidePicked = (side: Side): boolean =>
    total > 0 && conflictIndices.every((i) => sideFullyPicked(i, side));

  const togglePaneSide = async (side: Side) => {
    if (!blocks || !(await guardManual())) return;
    const takeAll = !allOfSidePicked(side);
    setPicks((prev) => {
      const next = new Map(prev);
      for (const i of conflictIndices) {
        const block = blocks[i] as ConflictBlock;
        const lines = side === 'current' ? block.current : block.incoming;
        let blockPicks = [...(next.get(i) ?? [])];
        blockPicks = blockPicks.filter((p) => p.side !== side);
        if (takeAll) {
          if (lines.length === 0) blockPicks.push({ side, line: EMPTY_SIDE });
          else lines.forEach((_, li) => blockPicks.push({ side, line: li }));
        }
        next.set(i, blockPicks);
      }
      return next;
    });
  };

  const reset = async () => {
    if (manualText !== null) {
      if (!(await guardManual())) return;
    }
    setPicks(new Map());
  };

  const jump = (direction: 1 | -1) => {
    if (total === 0) return;
    const next = (activeConflict + direction + total) % total;
    setActiveConflict(next);
    blockRefs.current.get(conflictIndices[next])?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const explain = async (current: string, incoming: string) => {
    if (!aiConfigured()) {
      toast.info('Configure an AI provider in Settings first');
      return;
    }
    setAiBusy(true);
    try {
      setAiText(await aiCapabilities.explainConflict(getAiProvider(), file, current, incoming));
    } catch (error) {
      toast.error(`AI request failed: ${(error as { message?: string }).message ?? error}`);
    } finally {
      setAiBusy(false);
    }
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await ipc.conflictResolve(path, file, manualText ?? buildResult());
      toast.success(`${file} resolved`);
      openConflict(null);
      await onResolved();
    } catch (error) {
      toast.error(`Save failed: ${(error as { message?: string }).message ?? error}`);
    } finally {
      setSaving(false);
    }
  };

  const renderSideCell = (block: ConflictBlock, index: number, side: Side) => {
    const lines = side === 'current' ? block.current : block.incoming;
    return (
      <div
        className={cn(
          'min-w-0',
          side === 'current' ? 'border-r border-border-subtle bg-info/5' : 'bg-success/5',
        )}
      >
        {lines.length === 0 ? (
          <label className="flex cursor-pointer items-center gap-2 px-3 py-1">
            <Checkbox
              checked={isPicked(index, side, EMPTY_SIDE)}
              onCheckedChange={() => void toggleLine(index, side, EMPTY_SIDE)}
              aria-label={`Take empty ${side} side (deletes this section)`}
            />
            <span className="font-mono text-xs italic leading-5 text-faint">(no lines — deletes this section)</span>
          </label>
        ) : (
          lines.map((line, li) => (
            <label
              key={li}
              className={cn(
                'flex cursor-pointer items-start gap-2 px-3 py-0.5 transition-colors',
                isPicked(index, side, li)
                  ? side === 'current'
                    ? 'bg-info/15'
                    : 'bg-success/15'
                  : 'hover:bg-surface-raised/80',
              )}
            >
              <Checkbox
                className="mt-1"
                checked={isPicked(index, side, li)}
                onCheckedChange={() => void toggleLine(index, side, li)}
                aria-label={`Take line ${li + 1} from ${side}`}
              />
              <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-xs leading-5">
                {line || ' '}
              </pre>
            </label>
          ))
        )}
      </div>
    );
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      role="dialog"
      aria-label={`Resolve conflicts in ${file}`}
    >
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border-subtle bg-surface px-4">
        <span className="text-sm font-semibold">Resolve conflicts</span>
        <span className="truncate font-mono text-xs text-muted">{file}</span>
        <Badge tone={resolvedCount === total ? 'success' : 'primary'}>
          {resolvedCount}/{total} resolved
        </Badge>
        {total > 1 && (
          <span className="flex items-center gap-0.5">
            <Hint label="Previous conflict">
              <Button variant="ghost" size="icon-sm" aria-label="Previous conflict" onClick={() => jump(-1)}>
                <ChevronUp className="size-4" />
              </Button>
            </Hint>
            <Hint label="Next conflict">
              <Button variant="ghost" size="icon-sm" aria-label="Next conflict" onClick={() => jump(1)}>
                <ChevronDown className="size-4" />
              </Button>
            </Hint>
            <span className="text-[10px] text-faint">
              {activeConflict + 1}/{total}
            </span>
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Hint
            label={
              manualHasMarkers
                ? 'Remove the remaining <<<<<<< markers from the Output first'
                : !canSave
                  ? 'Pick lines for every conflict (or edit the Output by hand) first'
                  : 'Write the result and mark the file resolved'
            }
          >
            <span>
              <Button size="sm" disabled={!canSave || saving} onClick={() => void save()}>
                {saving ? <Spinner className="text-primary-foreground" /> : <Check />}
                Mark resolved
              </Button>
            </span>
          </Hint>
          <Button variant="ghost" size="icon" aria-label="Close" onClick={() => openConflict(null)}>
            <X />
          </Button>
        </div>
      </header>

      {!blocks ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="size-6" />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-[3] overflow-y-auto">
            <div className="sticky top-0 z-10 grid grid-cols-2 border-b border-border-subtle bg-surface">
              <label className="flex cursor-pointer items-center gap-2 border-r border-border-subtle px-3 py-1.5">
                <Checkbox
                  checked={allOfSidePicked('current')}
                  onCheckedChange={() => void togglePaneSide('current')}
                  aria-label="Take all lines from side A"
                />
                <Badge tone="info">A</Badge>
                <span className="truncate text-xs font-medium text-info">{aLabel}</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5">
                <Checkbox
                  checked={allOfSidePicked('incoming')}
                  onCheckedChange={() => void togglePaneSide('incoming')}
                  aria-label="Take all lines from side B"
                />
                <Badge tone="success">B</Badge>
                <span className="truncate text-xs font-medium text-success">{bLabel}</span>
              </label>
            </div>
            {blocks.map((block, index) =>
              block.kind === 'text' ? (
                <div key={index} className="grid grid-cols-2">
                  <pre className="min-w-0 whitespace-pre-wrap break-words border-r border-border-subtle px-3 py-0.5 font-mono text-xs leading-5 text-faint">
                    {block.lines.join('\n')}
                  </pre>
                  <pre className="min-w-0 whitespace-pre-wrap break-words px-3 py-0.5 font-mono text-xs leading-5 text-faint">
                    {block.lines.join('\n')}
                  </pre>
                </div>
              ) : (
                <div
                  key={index}
                  ref={(el) => {
                    if (el) blockRefs.current.set(index, el);
                    else blockRefs.current.delete(index);
                  }}
                  className={cn(
                    'relative border-y border-border transition-shadow',
                    conflictIndices[activeConflict] === index && 'ring-1 ring-primary/50',
                  )}
                >
                  <div className="grid grid-cols-2">
                    {renderSideCell(block, index, 'current')}
                    {renderSideCell(block, index, 'incoming')}
                  </div>
                  <Hint label="Explain this conflict with AI">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full border border-border bg-surface shadow-soft"
                      disabled={aiBusy}
                      aria-label="Explain this conflict with AI"
                      onClick={() => void explain(block.current.join('\n'), block.incoming.join('\n'))}
                    >
                      {aiBusy ? <Spinner className="size-3" /> : <Sparkles className="size-3 text-primary" />}
                    </Button>
                  </Hint>
                </div>
              ),
            )}
            {aiText && (
              <div className="m-4 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs leading-relaxed">
                <pre className="min-w-0 whitespace-pre-wrap break-words font-sans">{aiText}</pre>
              </div>
            )}
          </div>

          <div className="flex min-h-0 flex-[2] flex-col border-t border-border">
            <div className="flex items-center gap-2 border-b border-border-subtle bg-surface px-3 py-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Output</span>
              {manualText !== null ? (
                <>
                  <Badge tone="primary">
                    <Pencil className="size-2.5" /> edited by hand
                  </Badge>
                  {manualHasMarkers && <Badge tone="danger">markers remain</Badge>}
                </>
              ) : (
                <span className="text-[10px] text-faint">
                  {resolvedCount === total
                    ? 'Ready to mark resolved'
                    : 'Pick lines from A and B — they appear here in the order you pick them'}
                </span>
              )}
              <span className="ml-auto flex items-center gap-1">
                {manualText === null ? (
                  <Hint label="Edit the output by hand">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Edit output by hand"
                      onClick={() => setManualText(buildResult())}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                  </Hint>
                ) : (
                  <Hint label="Discard manual edits and rebuild from the checkboxes">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Reset manual edits"
                      onClick={() => setManualText(null)}
                    >
                      <RotateCcw className="size-3.5" />
                    </Button>
                  </Hint>
                )}
                <Button variant="ghost" size="sm" onClick={() => void reset()}>
                  Reset
                </Button>
              </span>
            </div>
            {manualText !== null ? (
              <textarea
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                spellCheck={false}
                aria-label="Resolved file content (editable)"
                className={cn(
                  'min-h-0 flex-1 resize-none bg-transparent px-4 py-2 font-mono text-xs leading-5 text-foreground',
                  'focus:outline-none focus:ring-1 focus:ring-inset focus:ring-primary/40',
                )}
              />
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto py-1">
                {blocks.map((block, index) => {
                  if (block.kind === 'text') {
                    return (
                      <pre
                        key={index}
                        className="whitespace-pre-wrap break-words px-8 py-0.5 font-mono text-xs leading-5 text-muted"
                      >
                        {block.lines.join('\n')}
                      </pre>
                    );
                  }
                  const blockPicks = picks.get(index) ?? [];
                  if (blockPicks.length === 0) {
                    return (
                      <div
                        key={index}
                        className="flex items-center gap-2 border-y border-danger/30 bg-danger/10 px-3 py-1 text-xs text-danger"
                      >
                        <span className="font-semibold">Unresolved</span>
                        <span className="text-danger/80">pick lines from A or B above, or edit by hand</span>
                      </div>
                    );
                  }
                  return (
                    <div key={index}>
                      {blockPicks
                        .filter((p) => p.line !== EMPTY_SIDE)
                        .map((p, pi) => (
                          <div
                            key={pi}
                            className={cn(
                              'flex items-start gap-2 px-2',
                              p.side === 'current' ? 'bg-info/10' : 'bg-success/10',
                            )}
                          >
                            <span
                              className={cn(
                                'w-4 shrink-0 text-center font-mono text-[10px] font-bold leading-5',
                                p.side === 'current' ? 'text-info' : 'text-success',
                              )}
                            >
                              {p.side === 'current' ? 'A' : 'B'}
                            </span>
                            <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-xs leading-5">
                              {(p.side === 'current' ? block.current : block.incoming)[p.line] || ' '}
                            </pre>
                          </div>
                        ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
}
