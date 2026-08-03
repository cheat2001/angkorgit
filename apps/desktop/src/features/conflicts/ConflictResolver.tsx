import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { Check, ChevronDown, ChevronUp, Pencil, RotateCcw, Sparkles, X } from 'lucide-react';
import {
  allResolved,
  aiCapabilities,
  conflictCount,
  parseConflicts,
  serializeResolution,
  type Block,
  type ConflictBlock,
  type Resolution,
} from '@angkorgit/core';
import { Badge, Button, Checkbox, Hint, Spinner, cn } from '@angkorgit/design-system';
import { ipc } from '@/core/ipc';
import { useRepo } from '@/features/repository/store';
import { useUi } from '@/features/ui/store';
import { aiConfigured, getAiProvider } from '@/features/ai/client';
import { confirmDialog } from '@/components/confirm';

/**
 * Visual conflict resolver, GitKraken-style:
 *  - Current | Incoming panes with a checkbox per side (check both = keep both)
 *  - prev/next conflict navigation
 *  - an EDITABLE Result pane — quick-pick with checkboxes, then fine-tune the
 *    output by hand; manual edits are tracked and guarded.
 */
export function ConflictResolver({ file, onResolved }: { file: string; onResolved: () => Promise<void> }) {
  const repo = useRepo((s) => s.repo);
  const openConflict = useUi((s) => s.openConflict);
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  /** non-null once the user typed in the result pane */
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
      .then((cf) => !cancelled && setBlocks(parseConflicts(cf.content)))
      .catch((error) => {
        toast.error(`Could not read ${file}: ${(error as { message?: string }).message ?? error}`);
        openConflict(null);
      });
    return () => {
      cancelled = true;
    };
  }, [path, file, openConflict]);

  const total = useMemo(() => (blocks ? conflictCount(blocks) : 0), [blocks]);
  const resolvedCount = useMemo(
    () => (blocks ? blocks.filter((b) => b.kind === 'conflict' && b.resolution !== 'unresolved').length : 0),
    [blocks],
  );
  /** indices (into blocks) of conflict blocks, for navigation */
  const conflictIndices = useMemo(
    () => (blocks ? blocks.flatMap((b, i) => (b.kind === 'conflict' ? [i] : [])) : []),
    [blocks],
  );

  const generated = useMemo(() => (blocks ? serializeResolution(blocks) : ''), [blocks]);
  const resultText = manualText ?? generated;
  const manualHasMarkers = manualText !== null && manualText.includes('<<<<<<<');
  const canSave = manualText !== null ? !manualHasMarkers : blocks !== null && allResolved(blocks);

  /** Block-level actions regenerate the result — guard hand edits. */
  const guardManual = async (): Promise<boolean> => {
    if (manualText === null) return true;
    const ok = await confirmDialog({
      title: 'Replace manual edits?',
      description: 'Your hand-written Result will be replaced by the resolution generated from the checkboxes.',
      confirmLabel: 'Replace',
      destructive: true,
    });
    if (ok) setManualText(null);
    return ok;
  };

  const setResolution = async (index: number, resolution: Resolution) => {
    if (!(await guardManual())) return;
    setBlocks((prev) =>
      prev ? prev.map((b, i) => (i === index && b.kind === 'conflict' ? { ...b, resolution } : b)) : prev,
    );
  };

  /** Checkbox model: current/incoming independently toggleable. */
  const toggleSide = (index: number, side: 'current' | 'incoming', block: ConflictBlock) => {
    const cur = block.resolution === 'current' || block.resolution === 'both';
    const inc = block.resolution === 'incoming' || block.resolution === 'both';
    const next = { current: side === 'current' ? !cur : cur, incoming: side === 'incoming' ? !inc : inc };
    const resolution: Resolution =
      next.current && next.incoming ? 'both' : next.current ? 'current' : next.incoming ? 'incoming' : 'unresolved';
    void setResolution(index, resolution);
  };

  const resolveAll = async (resolution: Resolution) => {
    if (!(await guardManual())) return;
    setBlocks((prev) => (prev ? prev.map((b) => (b.kind === 'conflict' ? { ...b, resolution } : b)) : prev));
  };

  const jump = (direction: 1 | -1) => {
    if (conflictIndices.length === 0) return;
    const next = (activeConflict + direction + conflictIndices.length) % conflictIndices.length;
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
      await ipc.conflictResolve(path, file, resultText);
      toast.success(`${file} resolved`);
      openConflict(null);
      await onResolved();
    } catch (error) {
      toast.error(`Save failed: ${(error as { message?: string }).message ?? error}`);
    } finally {
      setSaving(false);
    }
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
          <Button variant="ghost" size="sm" onClick={() => void resolveAll('current')}>
            All current
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void resolveAll('incoming')}>
            All incoming
          </Button>
          <Hint
            label={
              manualHasMarkers
                ? 'Remove the remaining <<<<<<< markers from the Result first'
                : !canSave
                  ? 'Resolve every conflict (or edit the Result directly) first'
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
        <div className="flex min-h-0 flex-1">
          {/* Current + Incoming panes */}
          <div className="flex min-h-0 flex-[2] flex-col overflow-y-auto border-r border-border-subtle">
            {blocks.map((block, index) =>
              block.kind === 'text' ? (
                <pre key={index} className="whitespace-pre-wrap px-4 py-0.5 font-mono text-xs leading-5 text-faint">
                  {block.lines.join('\n')}
                </pre>
              ) : (
                <div
                  key={index}
                  ref={(el) => {
                    if (el) blockRefs.current.set(index, el);
                    else blockRefs.current.delete(index);
                  }}
                  className={cn(
                    'my-2 border-y border-border transition-shadow',
                    conflictIndices[activeConflict] === index && 'ring-1 ring-primary/50',
                  )}
                >
                  <div className="flex">
                    <div
                      className={cn(
                        'w-1/2 border-r border-border-subtle bg-info/5',
                        (block.resolution === 'current' || block.resolution === 'both') &&
                          'ring-1 ring-inset ring-info/60',
                      )}
                    >
                      <label className="flex cursor-pointer items-center gap-2 border-b border-border-subtle px-2 py-1.5">
                        <Checkbox
                          checked={block.resolution === 'current' || block.resolution === 'both'}
                          onCheckedChange={() => toggleSide(index, 'current', block)}
                          aria-label="Use current side"
                        />
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-info">
                          Current {block.currentLabel && `(${block.currentLabel})`}
                        </span>
                      </label>
                      <pre className="whitespace-pre-wrap p-2 font-mono text-xs leading-5">
                        {block.current.join('\n')}
                      </pre>
                    </div>
                    <div
                      className={cn(
                        'w-1/2 bg-success/5',
                        (block.resolution === 'incoming' || block.resolution === 'both') &&
                          'ring-1 ring-inset ring-success/60',
                      )}
                    >
                      <label className="flex cursor-pointer items-center gap-2 border-b border-border-subtle px-2 py-1.5">
                        <Checkbox
                          checked={block.resolution === 'incoming' || block.resolution === 'both'}
                          onCheckedChange={() => toggleSide(index, 'incoming', block)}
                          aria-label="Use incoming side"
                        />
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-success">
                          Incoming {block.incomingLabel && `(${block.incomingLabel})`}
                        </span>
                      </label>
                      <pre className="whitespace-pre-wrap p-2 font-mono text-xs leading-5">
                        {block.incoming.join('\n')}
                      </pre>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 border-t border-border-subtle bg-surface-raised/60 px-2 py-1">
                    <span className="text-[10px] text-faint">
                      Check one side, both, or edit the Result directly →
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto"
                      disabled={aiBusy}
                      onClick={() => void explain(block.current.join('\n'), block.incoming.join('\n'))}
                    >
                      {aiBusy ? <Spinner className="size-3" /> : <Sparkles className="size-3 text-primary" />}
                      Explain
                    </Button>
                  </div>
                </div>
              ),
            )}
            {aiText && (
              <div className="m-4 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs leading-relaxed">
                <pre className="whitespace-pre-wrap font-sans">{aiText}</pre>
              </div>
            )}
          </div>

          {/* Result pane — editable */}
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b border-border-subtle bg-surface px-3 py-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Result</span>
              {manualText !== null ? (
                <>
                  <Badge tone="primary">
                    <Pencil className="size-2.5" /> edited by hand
                  </Badge>
                  {manualHasMarkers && <Badge tone="danger">markers remain</Badge>}
                  <Hint label="Discard manual edits and regenerate from the checkboxes">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="ml-auto"
                      aria-label="Reset manual edits"
                      onClick={() => setManualText(null)}
                    >
                      <RotateCcw className="size-3.5" />
                    </Button>
                  </Hint>
                </>
              ) : (
                <span className="ml-auto text-[10px] text-faint">click to edit</span>
              )}
            </div>
            <textarea
              value={resultText}
              onChange={(e) => setManualText(e.target.value)}
              spellCheck={false}
              aria-label="Resolved file content (editable)"
              className={cn(
                'min-h-0 flex-1 resize-none bg-transparent px-4 py-2 font-mono text-xs leading-5 text-foreground',
                'focus:outline-none focus:ring-1 focus:ring-inset focus:ring-primary/40',
              )}
            />
          </div>
        </div>
      )}
    </motion.div>
  );
}
