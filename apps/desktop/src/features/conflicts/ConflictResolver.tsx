import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { basename, dirname } from '@/shared/utils';
import { useVirtualizer } from '@tanstack/react-virtual';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { Check, ChevronDown, ChevronUp, GitMerge, Pencil, RotateCcw, Sparkles, X } from 'lucide-react';
import {
  aiCapabilities,
  parseConflicts,
  serializeResolution,
  type Block,
  type ConflictBlock,
} from '@angkorgit/core';
import { Badge, Button, Checkbox, Hint, Logo, Spinner, cn } from '@angkorgit/design-system';
import { ipc } from '@/core/ipc';
import { useRepo } from '@/features/repository/store';
import { useSettings } from '@/features/settings/store';
import { useUi } from '@/features/ui/store';
import { aiConfigured, getAiProvider } from '@/features/ai/client';
import { AiText } from '@/features/ai/AiText';
import { confirmDialog } from '@/components/confirm';

type Side = 'current' | 'incoming';

interface Pick {
  side: Side;
  line: number;
}

const EMPTY_SIDE = -1;
const VIRTUAL_THRESHOLD = 1500;
const TEXT_ROW_HEIGHT = 20;
const CONFLICT_ROW_HEIGHT = 24;

type PaneRow =
  | { kind: 'text'; block: number; text: string; li: number }
  | { kind: 'header'; block: number }
  | { kind: 'conflict'; block: number; li: number; last: boolean };

interface SideStart {
  a: number;
  b: number;
}

type OutputRow =
  | { kind: 'text'; text: string; key: string; lineNo: number }
  | { kind: 'unresolved'; block: number; text: string; key: string; lineNo: number }
  | { kind: 'pick'; side: Side; text: string; block: number; first: boolean; key: string; lineNo: number }
  | { kind: 'edited'; text: string; block: number; first: boolean; key: string; lineNo: number }
  | { kind: 'deleted'; block: number; side: Side | null; key: string }
  | { kind: 'editor'; block: number; key: string };

const MARKER_LINE = /^<{7}(?: |\r?$)/m;

function unresolvedPreview(block: ConflictBlock): string[] {
  if (block.base && block.base.length > 0) return block.base;
  if (block.current.length > 0) return block.current;
  return [''];
}

function stripCr(line: string): string {
  return line.replace(/\r$/, '');
}

function blockUsesCrlf(block: ConflictBlock): boolean {
  return block.markers.open.endsWith('\r');
}

function editSaveLines(edit: string, crlf: boolean): string[] {
  if (edit === '') return [];
  const lines = edit.split('\n').map(stripCr);
  return crlf ? lines.map((line) => `${line}\r`) : lines;
}

function buildPaneRows(blocks: Block[] | null): {
  rows: PaneRow[];
  blockStart: Map<number, number>;
  lineStart: Map<number, SideStart>;
} {
  const rows: PaneRow[] = [];
  const blockStart = new Map<number, number>();
  const lineStart = new Map<number, SideStart>();
  let a = 1;
  let b = 1;
  (blocks ?? []).forEach((blk, block) => {
    blockStart.set(block, rows.length);
    lineStart.set(block, { a, b });
    if (blk.kind === 'text') {
      blk.lines.forEach((text, li) => rows.push({ kind: 'text', block, text, li }));
      a += blk.lines.length;
      b += blk.lines.length;
      return;
    }
    rows.push({ kind: 'header', block });
    const count = Math.max(blk.current.length || 1, blk.incoming.length || 1);
    for (let li = 0; li < count; li += 1) {
      rows.push({ kind: 'conflict', block, li, last: li === count - 1 });
    }
    a += blk.current.length;
    b += blk.incoming.length;
  });
  return { rows, blockStart, lineStart };
}

function LineNo({ n }: { n: number | null }) {
  return (
    <span className="w-9 shrink-0 select-none pr-2 text-right font-mono text-[10px] leading-5 text-faint tabular-nums">
      {n ?? ''}
    </span>
  );
}

function useOffsetTop(ref: React.RefObject<HTMLDivElement>): number {
  const [offset, setOffset] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) setOffset((prev) => (prev === el.offsetTop ? prev : el.offsetTop));
  });
  return offset;
}

function sideLabel(block: ConflictBlock, side: Side, headBranch: string | null): string {
  const raw = side === 'current' ? block.currentLabel : block.incomingLabel;
  if (side === 'current' && (raw === 'HEAD' || raw === '') && headBranch) return headBranch;
  return raw || (side === 'current' ? 'current' : 'incoming');
}

export function ConflictResolver({ file, onResolved }: { file: string; onResolved: () => Promise<void> }) {
  const repo = useRepo((s) => s.repo);
  const openConflict = useUi((s) => s.openConflict);
  const overlayRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    overlayRef.current?.focus({ preventScroll: true });
  }, []);
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [picks, setPicks] = useState<Map<number, Pick[]>>(new Map());
  const [manualText, setManualText] = useState<string | null>(null);
  const [activeConflict, setActiveConflict] = useState(0);
  const [saving, setSaving] = useState(false);
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const aiRunRef = useRef(0);
  const [blockEdits, setBlockEdits] = useState<Map<number, string>>(new Map());
  const [editingBlock, setEditingBlock] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [lastTouched, setLastTouched] = useState<number | null>(null);
  const editSessionRef = useRef<{ block: number; before: string | undefined; focused: boolean } | null>(
    null,
  );
  const blockRefs = useRef(new Map<number, HTMLDivElement>());
  const outputBlockRefs = useRef(new Map<number, HTMLDivElement>());
  const topScrollRef = useRef<HTMLDivElement>(null);
  const topListRef = useRef<HTMLDivElement>(null);
  const outputScrollRef = useRef<HTMLDivElement>(null);
  const outputListRef = useRef<HTMLDivElement>(null);

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
        setBlockEdits(new Map());
        editSessionRef.current = null;
        setEditingBlock(null);
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
  const paneModel = useMemo(() => buildPaneRows(blocks), [blocks]);
  const virtualized = paneModel.rows.length > VIRTUAL_THRESHOLD;
  const outputStarts = useMemo(() => {
    const starts = new Map<number, number>();
    let n = 1;
    (blocks ?? []).forEach((block, index) => {
      starts.set(index, n);
      if (block.kind === 'text') {
        n += block.lines.length;
        return;
      }
      if (editingBlock === index) {
        n += Math.max(1, editDraft === '' ? 0 : editDraft.split('\n').length);
        return;
      }
      const edit = blockEdits.get(index);
      if (edit !== undefined) {
        n += edit === '' ? 0 : edit.split('\n').length;
        return;
      }
      const blockPicks = picks.get(index) ?? [];
      if (blockPicks.length === 0) {
        n += unresolvedPreview(block).length;
        return;
      }
      n += blockPicks.filter((p) => p.line !== EMPTY_SIDE).length;
    });
    return starts;
  }, [blocks, picks, blockEdits, editingBlock, editDraft]);

  const outputModel = useMemo<{ rows: OutputRow[]; blockRow: Map<number, number> }>(() => {
    const rows: OutputRow[] = [];
    const blockRow = new Map<number, number>();
    if (!virtualized || !blocks) return { rows, blockRow };
    blocks.forEach((block, index) => {
      const start = outputStarts.get(index) ?? 1;
      if (block.kind === 'text') {
        block.lines.forEach((text, li) => rows.push({ kind: 'text', text, key: `t${index}:${li}`, lineNo: start + li }));
        return;
      }
      blockRow.set(index, rows.length);
      if (editingBlock === index) {
        rows.push({ kind: 'editor', block: index, key: `ed${index}` });
        return;
      }
      const edit = blockEdits.get(index);
      if (edit !== undefined) {
        if (edit === '') {
          rows.push({ kind: 'deleted', block: index, side: null, key: `d${index}` });
          return;
        }
        edit
          .split('\n')
          .forEach((text, li) =>
            rows.push({ kind: 'edited', text, block: index, first: li === 0, key: `e${index}:${li}`, lineNo: start + li }),
          );
        return;
      }
      const blockPicks = picks.get(index) ?? [];
      if (blockPicks.length === 0) {
        unresolvedPreview(block).forEach((text, li) =>
          rows.push({ kind: 'unresolved', block: index, text, key: `u${index}:${li}`, lineNo: start + li }),
        );
        return;
      }
      const kept = blockPicks.filter((p) => p.line !== EMPTY_SIDE);
      if (kept.length === 0) {
        rows.push({ kind: 'deleted', block: index, side: blockPicks[0]?.side ?? null, key: `d${index}` });
        return;
      }
      kept.forEach((p, pi) =>
        rows.push({
          kind: 'pick',
          side: p.side,
          text: (p.side === 'current' ? block.current : block.incoming)[p.line],
          block: index,
          first: pi === 0,
          key: `p${index}:${pi}`,
          lineNo: start + pi,
        }),
      );
    });
    return { rows, blockRow };
  }, [virtualized, blocks, picks, blockEdits, editingBlock, outputStarts]);

  const topMargin = useOffsetTop(topListRef);
  const outputMargin = useOffsetTop(outputListRef);

  const topVirtualizer = useVirtualizer({
    count: paneModel.rows.length,
    getScrollElement: () => topScrollRef.current,
    estimateSize: (index) =>
      paneModel.rows[index].kind === 'text' ? TEXT_ROW_HEIGHT : CONFLICT_ROW_HEIGHT,
    overscan: 20,
    scrollMargin: topMargin,
    enabled: virtualized,
  });

  const outputVirtualizer = useVirtualizer({
    count: outputModel.rows.length,
    getScrollElement: () => outputScrollRef.current,
    estimateSize: (index) => (outputModel.rows[index].kind === 'editor' ? 240 : TEXT_ROW_HEIGHT),
    getItemKey: (index) => outputModel.rows[index].key,
    overscan: 20,
    scrollMargin: outputMargin,
    enabled: virtualized,
  });
  const total = conflictIndices.length;
  const resolvedCount = useMemo(
    () => conflictIndices.filter((i) => (picks.get(i)?.length ?? 0) > 0 || blockEdits.has(i)).length,
    [conflictIndices, picks, blockEdits],
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
      const edit = blockEdits.get(i);
      const blockPicks = picks.get(i) ?? [];
      if (edit === undefined && blockPicks.length === 0) return b;
      manualEdits.set(i, edit !== undefined ? editSaveLines(edit, blockUsesCrlf(b)) : pickedLines(b, blockPicks));
      return { ...b, resolution: 'manual' as const };
    });
    return serializeResolution(resolved, manualEdits);
  };

  const manualHasMarkers = manualText !== null && MARKER_LINE.test(manualText);
  const blockEditsHaveMarkers = useMemo(
    () => [...blockEdits.values()].some((t) => MARKER_LINE.test(t)),
    [blockEdits],
  );
  const canSave =
    manualText !== null
      ? !manualHasMarkers
      : blocks !== null && resolvedCount === total && !blockEditsHaveMarkers;

  const guardEdits = async (blockIndex?: number): Promise<boolean> => {
    const replaceManual = manualText !== null;
    const replaceBlocks = blockIndex === undefined ? blockEdits.size > 0 : blockEdits.has(blockIndex);
    if (!replaceManual && !replaceBlocks) return true;
    const ok = await confirmDialog({
      title: 'Replace hand edits?',
      description: replaceManual
        ? 'Your hand-written Output (and any hand-edited conflicts) will be replaced by the resolution built from the checkboxes.'
        : blockIndex === undefined
          ? 'Hand-edited conflict results will be replaced by the lines you pick.'
          : "This conflict's hand-edited result will be replaced by the lines you pick.",
      confirmLabel: 'Replace',
      destructive: true,
    });
    if (!ok) return false;
    if (replaceManual) setManualText(null);
    if (replaceBlocks) {
      if (blockIndex === undefined) setBlockEdits(new Map());
      else
        setBlockEdits((prev) => {
          const next = new Map(prev);
          next.delete(blockIndex);
          return next;
        });
    }
    return true;
  };

  const isPicked = (index: number, side: Side, line: number) =>
    (picks.get(index) ?? []).some((p) => p.side === side && p.line === line);

  const toggleLine = async (index: number, side: Side, line: number) => {
    if (!(await guardEdits(index))) return;
    setPicks((prev) => {
      const next = new Map(prev);
      const blockPicks = [...(next.get(index) ?? [])];
      const at = blockPicks.findIndex((p) => p.side === side && p.line === line);
      if (at >= 0) blockPicks.splice(at, 1);
      else blockPicks.push({ side, line });
      next.set(index, blockPicks);
      return next;
    });
    const at = conflictIndices.indexOf(index);
    if (at >= 0) setActiveConflict(at);
    setLastTouched(index);
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

  const toggleBlockSide = async (index: number, side: Side) => {
    if (!blocks || !(await guardEdits(index))) return;
    const block = blocks[index] as ConflictBlock;
    const lines = side === 'current' ? block.current : block.incoming;
    const takeAll = !sideFullyPicked(index, side);
    setPicks((prev) => {
      const next = new Map(prev);
      const blockPicks = [...(next.get(index) ?? [])].filter((p) => p.side !== side);
      if (takeAll) {
        if (lines.length === 0) blockPicks.push({ side, line: EMPTY_SIDE });
        else lines.forEach((_, li) => blockPicks.push({ side, line: li }));
      }
      next.set(index, blockPicks);
      return next;
    });
    const at = conflictIndices.indexOf(index);
    if (at >= 0) setActiveConflict(at);
    setLastTouched(index);
  };

  const togglePaneSide = async (side: Side) => {
    if (!blocks || !(await guardEdits())) return;
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
    if (!(await guardEdits())) return;
    setPicks(new Map());
    editSessionRef.current = null;
    setEditingBlock(null);
  };

  const startEdit = (index: number) => {
    if (!blocks) return;
    const block = blocks[index] as ConflictBlock;
    const edit = blockEdits.get(index);
    const blockPicks = picks.get(index) ?? [];
    const initial =
      edit !== undefined
        ? edit
        : blockPicks.length > 0
          ? pickedLines(block, blockPicks).map(stripCr).join('\n')
          : [...block.current, ...block.incoming].map(stripCr).join('\n');
    editSessionRef.current = { block: index, before: edit, focused: false };
    setEditDraft(initial);
    setEditingBlock(index);
    const at = conflictIndices.indexOf(index);
    if (at >= 0) setActiveConflict(at);
    scrollTopToBlock(index);
  };

  const closeEditor = (revert: boolean) => {
    const session = editSessionRef.current;
    if (!session) return;
    if (revert) {
      setBlockEdits((prev) => {
        const next = new Map(prev);
        if (session.before === undefined) next.delete(session.block);
        else next.set(session.block, session.before);
        return next;
      });
    }
    editSessionRef.current = null;
    setEditingBlock(null);
  };

  const revertEdit = async (index: number) => {
    const ok = await confirmDialog({
      title: 'Discard hand-edited result?',
      description: 'This conflict goes back to the lines picked from A and B, or to unresolved.',
      confirmLabel: 'Discard',
      destructive: true,
    });
    if (!ok) return;
    setBlockEdits((prev) => {
      const next = new Map(prev);
      next.delete(index);
      return next;
    });
  };

  const registerOutputBlock = (index: number) => (el: HTMLDivElement | null) => {
    if (el) outputBlockRefs.current.set(index, el);
    else outputBlockRefs.current.delete(index);
  };

  const scrollOutputToBlock = (block: number) => {
    if (manualText !== null) return;
    if (virtualized) {
      const row = outputModel.blockRow.get(block);
      if (row !== undefined) outputVirtualizer.scrollToIndex(row, { align: 'center' });
    } else {
      outputBlockRefs.current
        .get(block)
        ?.scrollIntoView({
          behavior: useSettings.getState().reduceMotion ? 'auto' : 'smooth',
          block: 'center',
        });
    }
  };

  const scrollTopToBlock = (blockIndex: number) => {
    if (virtualized) {
      topVirtualizer.scrollToIndex(paneModel.blockStart.get(blockIndex) ?? 0, { align: 'center' });
    } else {
      blockRefs.current
        .get(blockIndex)
        ?.scrollIntoView({
          behavior: useSettings.getState().reduceMotion ? 'auto' : 'smooth',
          block: 'center',
        });
    }
  };

  useEffect(() => {
    if (lastTouched === null) return;
    scrollOutputToBlock(lastTouched);
    setLastTouched(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastTouched]);

  useEffect(() => {
    if (!blocks || conflictIndices.length === 0) return;
    const id = requestAnimationFrame(() => {
      scrollTopToBlock(conflictIndices[0]);
      scrollOutputToBlock(conflictIndices[0]);
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks]);

  const jump = (direction: 1 | -1) => {
    if (total === 0) return;
    const next = (activeConflict + direction + total) % total;
    setActiveConflict(next);
    const blockIndex = conflictIndices[next];
    scrollTopToBlock(blockIndex);
    scrollOutputToBlock(blockIndex);
  };

  const explain = async (current: string, incoming: string) => {
    if (!aiConfigured()) {
      toast.info('Configure an AI provider in Settings first');
      return;
    }
    const run = ++aiRunRef.current;
    const stillRunning = () => aiRunRef.current === run;
    setAiBusy(true);
    try {
      const text = await aiCapabilities.explainConflict(getAiProvider(), file, current, incoming);
      if (stillRunning()) setAiText(text);
    } catch (error) {
      if (stillRunning()) {
        toast.error(`AI request failed: ${(error as { message?: string } | null)?.message ?? String(error)}`);
      }
    } finally {
      if (stillRunning()) setAiBusy(false);
    }
  };

  const stopExplain = () => {
    aiRunRef.current += 1;
    setAiBusy(false);
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

  const renderRevertAction = (index: number) => (
    <span className="absolute right-2 top-0.5 z-10 flex items-center opacity-0 transition-opacity group-hover:opacity-100">
      <Hint label="Discard the hand edit and rebuild from the checkboxes">
        <Button
          variant="ghost"
          size="icon-sm"
          className="h-5 w-5 border border-border bg-surface shadow-soft"
          aria-label="Discard the hand edit for this conflict"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            void revertEdit(index);
          }}
        >
          <RotateCcw className="size-3" />
        </Button>
      </Hint>
    </span>
  );

  const renderDeletedRow = (index: number, side: Side | null) => (
    <div
      className={cn(
        'group relative flex cursor-text items-start gap-2 px-2 transition-shadow hover:ring-1 hover:ring-inset hover:ring-primary/40',
        side === 'current' ? 'bg-info/10' : side === 'incoming' ? 'bg-success/10' : 'bg-primary/10',
      )}
      onMouseDown={(e) => {
        e.preventDefault();
        startEdit(index);
      }}
    >
      <LineNo n={null} />
      {side === null ? (
        <span className="flex w-4 shrink-0 items-center justify-center leading-5">
          <Pencil className="size-3 text-primary" />
        </span>
      ) : (
        <span
          className={cn(
            'w-4 shrink-0 text-center font-mono text-[10px] font-bold leading-5',
            side === 'current' ? 'text-info' : 'text-success',
          )}
        >
          {side === 'current' ? 'A' : 'B'}
        </span>
      )}
      <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-xs italic leading-5 text-faint">
        (section deleted)
      </pre>
      {side === null && renderRevertAction(index)}
    </div>
  );

  const renderBlockEditor = (index: number) => (
    <div className="border-y border-primary/40 bg-primary/5">
      <textarea
        ref={(el) => {
          const session = editSessionRef.current;
          if (el && session && session.block === index && !session.focused) {
            session.focused = true;
            el.focus();
          }
        }}
        value={editDraft}
        onChange={(e) => {
          setEditDraft(e.target.value);
          setBlockEdits((prev) => new Map(prev).set(index, e.target.value));
        }}
        onBlur={() => {
          if (editSessionRef.current?.block === index) closeEditor(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            closeEditor(true);
          } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            closeEditor(false);
          }
        }}
        spellCheck={false}
        rows={Math.min(Math.max(editDraft.split('\n').length + 1, 2), 16)}
        aria-label="Hand-edited result for this conflict"
        className={cn(
          'w-full resize-none bg-transparent px-3 py-1 font-mono text-xs leading-5 text-foreground',
          'focus:outline-none',
        )}
      />
    </div>
  );

  const renderUnresolvedLine = (index: number, text: string, lineNo: number | null = null) => (
    <div
      className="flex cursor-text items-start gap-2 border-l-2 border-danger bg-danger/5 px-2 transition-colors hover:bg-danger/10"
      title="Unresolved conflict — click to edit the result, or pick lines above"
      onMouseDown={(e) => {
        e.preventDefault();
        startEdit(index);
      }}
    >
      <LineNo n={lineNo} />
      <span className="w-3.5 shrink-0" />
      <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-xs italic leading-5 text-faint">
        {text || ' '}
      </pre>
    </div>
  );

  const renderBlockSideAll = (index: number, side: Side) => (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-2 px-3 py-1',
        side === 'current' && 'border-r border-border-subtle',
      )}
    >
      {side === 'current' && (
        <span className="mr-1 shrink-0 rounded bg-surface px-1.5 py-px font-mono text-[10px] font-semibold text-muted">
          #{conflictIndices.indexOf(index) + 1}
        </span>
      )}
      <Checkbox
        checked={!blockEdits.has(index) && sideFullyPicked(index, side)}
        onCheckedChange={() => void toggleBlockSide(index, side)}
        aria-label={
          side === 'current'
            ? 'Take all lines from A for this conflict'
            : 'Take all lines from B for this conflict'
        }
      />
      <span
        className={cn(
          'text-[10px] font-medium',
          side === 'current' ? 'text-info' : 'text-success',
        )}
      >
        {side === 'current' ? 'Take all A' : 'Take all B'}
      </span>
    </label>
  );

  const renderSideCell = (block: ConflictBlock, index: number, side: Side) => {
    const lines = side === 'current' ? block.current : block.incoming;
    const start = paneModel.lineStart.get(index);
    const first = start ? (side === 'current' ? start.a : start.b) : null;
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
              <LineNo n={first === null ? null : first + li} />
              <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-xs leading-5">
                {line || ' '}
              </pre>
            </label>
          ))
        )}
      </div>
    );
  };

  const renderSideLine = (block: ConflictBlock, index: number, side: Side, li: number) => {
    const lines = side === 'current' ? block.current : block.incoming;
    const paneCls = side === 'current' ? 'border-r border-border-subtle bg-info/5' : 'bg-success/5';
    const start = paneModel.lineStart.get(index);
    const first = start ? (side === 'current' ? start.a : start.b) : null;
    if (lines.length === 0) {
      return (
        <div className={cn('min-w-0', paneCls)}>
          {li === 0 && (
            <label className="flex cursor-pointer items-center gap-2 px-3 py-1">
              <Checkbox
                checked={isPicked(index, side, EMPTY_SIDE)}
                onCheckedChange={() => void toggleLine(index, side, EMPTY_SIDE)}
                aria-label={`Take empty ${side} side (deletes this section)`}
              />
              <span className="font-mono text-xs italic leading-5 text-faint">(no lines — deletes this section)</span>
            </label>
          )}
        </div>
      );
    }
    if (li >= lines.length) return <div className={cn('min-w-0', paneCls)} />;
    return (
      <div className={cn('min-w-0', paneCls)}>
        <label
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
          <LineNo n={first === null ? null : first + li} />
          <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-xs leading-5">
            {lines[li] || ' '}
          </pre>
        </label>
      </div>
    );
  };

  return (
    <motion.div
      ref={overlayRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col bg-background outline-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      role="dialog"
      aria-modal="true"
      aria-label={`Resolve conflicts in ${file}`}
    >
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border-subtle bg-surface px-4">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-danger/15 text-danger">
          <GitMerge className="size-4" />
        </span>
        <div className="min-w-0 leading-tight">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-faint">Resolve conflicts</p>
          <p className="flex min-w-0 items-baseline gap-1.5 text-sm">
            <span className="max-w-full shrink-0 truncate font-semibold text-foreground">{basename(file)}</span>
            {dirname(file) && <span className="min-w-0 truncate font-mono text-[11px] text-faint">{dirname(file)}</span>}
          </p>
        </div>
        {total > 0 && (
          <div className="flex shrink-0 items-center gap-2" aria-label={`${resolvedCount} of ${total} conflicts resolved`}>
            <span className="h-1.5 w-28 overflow-hidden rounded-full bg-surface-raised">
              <span
                className={cn('block h-full rounded-full transition-[width] duration-300', resolvedCount === total ? 'bg-success' : 'bg-primary')}
                style={{ width: `${Math.round((resolvedCount / total) * 100)}%` }}
              />
            </span>
            <span className={cn('text-xs tabular-nums', resolvedCount === total ? 'text-success' : 'text-muted')}>
              {resolvedCount} of {total} resolved
            </span>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Hint
            label={
              manualHasMarkers || (manualText === null && blockEditsHaveMarkers)
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
          <Hint label="Close">
            <Button variant="ghost" size="icon" aria-label="Close" onClick={() => openConflict(null)}>
              <X />
            </Button>
          </Hint>
        </div>
      </header>

      {!blocks ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="size-6" />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-[3]">
            <div ref={topScrollRef} className="relative h-full overflow-y-auto pb-6">
            <div className="sticky top-0 z-10 grid grid-cols-2 border-b border-border-subtle bg-surface">
              <label className="flex cursor-pointer items-center gap-2 border-r border-t-2 border-border-subtle border-t-info/60 px-3 py-1.5">
                <Checkbox
                  checked={allOfSidePicked('current')}
                  onCheckedChange={() => void togglePaneSide('current')}
                  aria-label="Take all lines from side A"
                />
                <Badge tone="info">A</Badge>
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-info">{aLabel}</span>
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-faint">current</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 border-t-2 border-t-success/60 px-3 py-1.5">
                <Checkbox
                  checked={allOfSidePicked('incoming')}
                  onCheckedChange={() => void togglePaneSide('incoming')}
                  aria-label="Take all lines from side B"
                />
                <Badge tone="success">B</Badge>
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-success">{bLabel}</span>
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-faint">incoming</span>
              </label>
            </div>
            {virtualized ? (
              <div ref={topListRef} className="relative" style={{ height: topVirtualizer.getTotalSize() }}>
                {topVirtualizer.getVirtualItems().map((item) => {
                  const row = paneModel.rows[item.index];
                  const block = blocks[row.block];
                  const active = row.kind !== 'text' && conflictIndices[activeConflict] === row.block;
                  return (
                    <div
                      key={item.key}
                      ref={topVirtualizer.measureElement}
                      data-index={item.index}
                      className="absolute left-0 w-full"
                      style={{ transform: `translateY(${item.start - topMargin}px)` }}
                    >
                      {row.kind === 'text' || block.kind !== 'conflict' ? (
                        <div className="grid grid-cols-2">
                          <div className="flex min-w-0 items-start gap-2 border-r border-border-subtle px-3">
                            <span className="mt-1 w-4 shrink-0" />
                            <LineNo n={row.kind === 'text' ? (paneModel.lineStart.get(row.block)?.a ?? 1) + row.li : null} />
                            <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-faint">
                              {(row.kind === 'text' && row.text) || ' '}
                            </pre>
                          </div>
                          <div className="flex min-w-0 items-start gap-2 px-3">
                            <span className="mt-1 w-4 shrink-0" />
                            <LineNo n={row.kind === 'text' ? (paneModel.lineStart.get(row.block)?.b ?? 1) + row.li : null} />
                            <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-faint">
                              {(row.kind === 'text' && row.text) || ' '}
                            </pre>
                          </div>
                        </div>
                      ) : row.kind === 'header' ? (
                        <div
                          className={cn(
                            'relative border-x border-t',
                            active
                              ? 'border-x-primary/50 border-t-primary/50'
                              : 'border-x-transparent border-t-border-subtle',
                          )}
                        >
                          <div className="grid grid-cols-2 bg-surface-raised/60">
                            {renderBlockSideAll(row.block, 'current')}
                            {renderBlockSideAll(row.block, 'incoming')}
                          </div>
                          <Hint label="Explain this conflict with AI">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="absolute -top-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-border bg-surface shadow-soft"
                              disabled={aiBusy}
                              aria-label="Explain this conflict with AI"
                              onClick={() => void explain(block.current.join('\n'), block.incoming.join('\n'))}
                            >
                              {aiBusy ? <Logo size={14} animated="loop" className="logo-draw-loop" /> : <Sparkles className="size-3 text-primary" />}
                            </Button>
                          </Hint>
                        </div>
                      ) : (
                        <div
                          className={cn(
                            'relative border-x',
                            active ? 'border-x-primary/50' : 'border-x-transparent',
                            row.last && cn('border-b', active ? 'border-b-primary/50' : 'border-b-border-subtle'),
                          )}
                        >
                          <div className="grid grid-cols-2">
                            {renderSideLine(block, row.block, 'current', row.li)}
                            {renderSideLine(block, row.block, 'incoming', row.li)}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              blocks.map((block, index) =>
                block.kind === 'text' ? (
                  <div key={index} className="grid grid-cols-2 py-0.5">
                    <div className="min-w-0 border-r border-border-subtle px-3">
                      {block.lines.map((line, li) => (
                        <div key={li} className="flex items-start gap-2">
                          <span className="mt-1 w-4 shrink-0" />
                          <LineNo n={(paneModel.lineStart.get(index)?.a ?? 1) + li} />
                          <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-faint">{line || ' '}</pre>
                        </div>
                      ))}
                    </div>
                    <div className="min-w-0 px-3">
                      {block.lines.map((line, li) => (
                        <div key={li} className="flex items-start gap-2">
                          <span className="mt-1 w-4 shrink-0" />
                          <LineNo n={(paneModel.lineStart.get(index)?.b ?? 1) + li} />
                          <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-faint">{line || ' '}</pre>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div
                    key={index}
                    ref={(el) => {
                      if (el) blockRefs.current.set(index, el);
                      else blockRefs.current.delete(index);
                    }}
                    className={cn(
                      'relative border-y border-border-subtle transition-shadow',
                      conflictIndices[activeConflict] === index && 'ring-1 ring-primary/50',
                    )}
                  >
                    <div className="grid grid-cols-2 border-b border-border-subtle bg-surface-raised/60">
                      {renderBlockSideAll(index, 'current')}
                      {renderBlockSideAll(index, 'incoming')}
                    </div>
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
                        {aiBusy ? <Logo size={14} animated="loop" className="logo-draw-loop" /> : <Sparkles className="size-3 text-primary" />}
                      </Button>
                    </Hint>
                  </div>
                ),
              )
            )}
            </div>
            {(aiBusy || aiText) && (
              <div className="absolute bottom-3 right-3 z-20 flex max-h-[45%] w-[min(480px,90%)] flex-col overflow-hidden rounded-md border border-primary/30 bg-surface-overlay shadow-soft">
                <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle px-3 py-1.5">
                  <Sparkles className="size-3.5 text-primary" />
                  <span className="text-xs font-semibold">
                    {aiBusy ? 'Explaining conflict…' : 'AI explanation'}
                  </span>
                  <Hint label={aiBusy ? 'Stop explaining' : 'Dismiss'}>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="ml-auto h-5 w-5"
                      aria-label={aiBusy ? 'Stop the AI explanation' : 'Dismiss AI explanation'}
                      onClick={() => (aiBusy ? stopExplain() : setAiText(null))}
                    >
                      <X className="size-3" />
                    </Button>
                  </Hint>
                </div>
                {aiBusy ? (
                  <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted">
                    <Logo size={16} animated="loop" className="logo-draw-loop shrink-0" /> Reading
                    both sides of the conflict…
                  </div>
                ) : (
                  <div className="overflow-y-auto px-3 py-2 text-xs leading-relaxed">
                    <AiText text={aiText ?? ''} />
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="relative flex min-h-0 flex-[2] flex-col border-t border-border">
            <div className="flex items-center gap-2 border-b border-border-subtle bg-surface px-3 py-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Result</span>
              {total > 0 && (
                <span className="flex items-center gap-0.5 rounded-md border border-border-subtle bg-surface-raised/60 px-1">
                  <Hint label="Previous conflict">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="h-5 w-5"
                      aria-label="Previous conflict"
                      onClick={() => jump(-1)}
                    >
                      <ChevronUp className="size-3.5" />
                    </Button>
                  </Hint>
                  <span className="whitespace-nowrap px-1 text-[10px] font-medium tabular-nums text-muted">
                    Conflict {activeConflict + 1} of {total}
                  </span>
                  <Hint label="Next conflict">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="h-5 w-5"
                      aria-label="Next conflict"
                      onClick={() => jump(1)}
                    >
                      <ChevronDown className="size-3.5" />
                    </Button>
                  </Hint>
                </span>
              )}
              {manualText !== null ? (
                <>
                  <Badge tone="primary">
                    <Pencil className="size-2.5" /> edited by hand
                  </Badge>
                  {manualHasMarkers && <Badge tone="danger">markers remain</Badge>}
                </>
              ) : (
                <>
                  <span className="text-[10px] text-faint">
                    {resolvedCount === total
                      ? 'Ready to mark resolved — click any result to edit it'
                      : 'Pick lines from A and B — click any result to edit it by hand'}
                  </span>
                  {blockEdits.size > 0 && (
                    <Badge tone="primary">
                      <Pencil className="size-2.5" /> {blockEdits.size} edited by hand
                    </Badge>
                  )}
                </>
              )}
              <span className="ml-auto flex items-center gap-1">
                {manualText === null ? (
                  <Hint label="Edit the output by hand">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Edit output by hand"
                      onClick={() => {
                        setEditingBlock(null);
                        setManualText(buildResult());
                      }}
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
              <div ref={outputScrollRef} className="relative min-h-0 flex-1 overflow-y-auto py-1">
                {virtualized ? (
                  <div
                    ref={outputListRef}
                    className="relative"
                    style={{ height: outputVirtualizer.getTotalSize() }}
                  >
                    {outputVirtualizer.getVirtualItems().map((item) => {
                      const row = outputModel.rows[item.index];
                      return (
                        <div
                          key={item.key}
                          ref={outputVirtualizer.measureElement}
                          data-index={item.index}
                          className="absolute left-0 w-full"
                          style={{ transform: `translateY(${item.start - outputMargin}px)` }}
                        >
                          {row.kind === 'text' ? (
                            <div className="flex items-start px-2">
                              <LineNo n={row.lineNo} />
                              <span className="w-4 shrink-0" />
                              <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-muted">
                                {row.text || ' '}
                              </pre>
                            </div>
                          ) : row.kind === 'editor' ? (
                            renderBlockEditor(row.block)
                          ) : row.kind === 'unresolved' ? (
                            renderUnresolvedLine(row.block, row.text, row.lineNo)
                          ) : row.kind === 'deleted' ? (
                            renderDeletedRow(row.block, row.side)
                          ) : row.kind === 'edited' ? (
                            <div
                              className="group relative flex cursor-text items-start gap-2 bg-primary/10 px-2 transition-shadow hover:ring-1 hover:ring-inset hover:ring-primary/40"
                              onMouseDown={(e) => {
        e.preventDefault();
        startEdit(row.block);
      }}
                            >
                              <LineNo n={row.lineNo} />
                              <span className="flex w-4 shrink-0 items-center justify-center leading-5">
                                <Pencil className="size-3 text-primary" />
                              </span>
                              <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-xs leading-5">
                                {row.text || ' '}
                              </pre>
                              {row.first && renderRevertAction(row.block)}
                            </div>
                          ) : (
                            <div
                              className={cn(
                                'flex cursor-text items-start gap-2 px-2 transition-shadow hover:ring-1 hover:ring-inset hover:ring-primary/40',
                                row.side === 'current' ? 'bg-info/10' : 'bg-success/10',
                              )}
                              onMouseDown={(e) => {
        e.preventDefault();
        startEdit(row.block);
      }}
                            >
                              <LineNo n={row.lineNo} />
                              <span
                                className={cn(
                                  'w-4 shrink-0 text-center font-mono text-[10px] font-bold leading-5',
                                  row.side === 'current' ? 'text-info' : 'text-success',
                                )}
                              >
                                {row.side === 'current' ? 'A' : 'B'}
                              </span>
                              <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-xs leading-5">
                                {row.text || ' '}
                              </pre>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  blocks.map((block, index) => {
                    if (block.kind === 'text') {
                      const start = outputStarts.get(index) ?? 1;
                      return (
                        <div key={index} className="py-0.5">
                          {block.lines.map((line, li) => (
                            <div key={li} className="flex items-start px-2">
                              <LineNo n={start + li} />
                              <span className="w-4 shrink-0" />
                              <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-muted">
                                {line || ' '}
                              </pre>
                            </div>
                          ))}
                        </div>
                      );
                    }
                    if (editingBlock === index) {
                      return (
                        <div key={index} ref={registerOutputBlock(index)}>
                          {renderBlockEditor(index)}
                        </div>
                      );
                    }
                    const edit = blockEdits.get(index);
                    if (edit !== undefined) {
                      if (edit === '') {
                        return (
                          <div key={index} ref={registerOutputBlock(index)}>
                            {renderDeletedRow(index, null)}
                          </div>
                        );
                      }
                      return (
                        <div
                          key={index}
                          ref={registerOutputBlock(index)}
                          className="group relative cursor-text transition-shadow hover:ring-1 hover:ring-inset hover:ring-primary/40"
                          onMouseDown={(e) => {
        e.preventDefault();
        startEdit(index);
      }}
                        >
                          {edit.split('\n').map((line, li) => (
                            <div key={li} className="flex items-start gap-2 bg-primary/10 px-2">
                              <LineNo n={(outputStarts.get(index) ?? 1) + li} />
                              <span className="flex w-4 shrink-0 items-center justify-center leading-5">
                                <Pencil className="size-3 text-primary" />
                              </span>
                              <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-xs leading-5">
                                {line || ' '}
                              </pre>
                            </div>
                          ))}
                          {renderRevertAction(index)}
                        </div>
                      );
                    }
                    const blockPicks = picks.get(index) ?? [];
                    if (blockPicks.length === 0) {
                      return (
                        <div key={index} ref={registerOutputBlock(index)}>
                          {unresolvedPreview(block).map((text, li) => (
                            <div key={li}>{renderUnresolvedLine(index, text, (outputStarts.get(index) ?? 1) + li)}</div>
                          ))}
                        </div>
                      );
                    }
                    if (blockPicks.every((p) => p.line === EMPTY_SIDE)) {
                      return (
                        <div key={index} ref={registerOutputBlock(index)}>
                          {renderDeletedRow(index, blockPicks[0]?.side ?? null)}
                        </div>
                      );
                    }
                    return (
                      <div
                        key={index}
                        ref={registerOutputBlock(index)}
                        className="cursor-text transition-shadow hover:ring-1 hover:ring-inset hover:ring-primary/40"
                        onMouseDown={(e) => {
        e.preventDefault();
        startEdit(index);
      }}
                      >
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
                              <LineNo n={(outputStarts.get(index) ?? 1) + pi} />
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
                  })
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
}
