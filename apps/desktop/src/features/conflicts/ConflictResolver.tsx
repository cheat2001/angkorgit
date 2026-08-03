import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, Combine, Sparkles, X } from 'lucide-react';
import {
  allResolved,
  aiCapabilities,
  conflictCount,
  parseConflicts,
  serializeResolution,
  type Block,
  type Resolution,
} from '@angkorgit/core';
import { Badge, Button, Spinner, cn } from '@angkorgit/design-system';
import { ipc } from '@/core/ipc';
import { useRepo } from '@/features/repository/store';
import { useUi } from '@/features/ui/store';
import { aiConfigured, getAiProvider } from '@/features/ai/client';

/**
 * Visual conflict resolver: Current | Incoming | Result.
 * Per-conflict actions: Accept Current / Accept Incoming / Accept Both.
 */
export function ConflictResolver({ file, onResolved }: { file: string; onResolved: () => Promise<void> }) {
  const repo = useRepo((s) => s.repo);
  const openConflict = useUi((s) => s.openConflict);
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

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

  const setResolution = (index: number, resolution: Resolution) => {
    setBlocks((prev) =>
      prev
        ? prev.map((b, i) => (i === index && b.kind === 'conflict' ? { ...b, resolution } : b))
        : prev,
    );
  };

  const resolveAll = (resolution: Resolution) => {
    setBlocks((prev) =>
      prev ? prev.map((b) => (b.kind === 'conflict' ? { ...b, resolution } : b)) : prev,
    );
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
    if (!blocks || !allResolved(blocks)) return;
    setSaving(true);
    try {
      await ipc.conflictResolve(path, file, serializeResolution(blocks));
      toast.success(`${file} resolved`);
      openConflict(null);
      await onResolved();
    } catch (error) {
      toast.error(`Save failed: ${(error as { message?: string }).message ?? error}`);
    } finally {
      setSaving(false);
    }
  };

  const resultPreview = useMemo(() => (blocks ? serializeResolution(blocks) : ''), [blocks]);

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
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => resolveAll('current')}>
            <ArrowLeft className="size-3.5" /> All current
          </Button>
          <Button variant="ghost" size="sm" onClick={() => resolveAll('incoming')}>
            All incoming <ArrowRight className="size-3.5" />
          </Button>
          <Button
            size="sm"
            disabled={!blocks || !allResolved(blocks) || saving}
            onClick={() => void save()}
          >
            {saving ? <Spinner className="text-primary-foreground" /> : <Check />}
            Mark resolved
          </Button>
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
                <div key={index} className="my-2 border-y border-border">
                  <div className="flex">
                    <div
                      className={cn(
                        'w-1/2 border-r border-border-subtle bg-info/5 p-2',
                        block.resolution === 'current' || block.resolution === 'both' ? 'ring-1 ring-inset ring-info/60' : '',
                      )}
                    >
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-info">
                        Current {block.currentLabel && `(${block.currentLabel})`}
                      </p>
                      <pre className="whitespace-pre-wrap font-mono text-xs leading-5">{block.current.join('\n')}</pre>
                    </div>
                    <div
                      className={cn(
                        'w-1/2 bg-success/5 p-2',
                        block.resolution === 'incoming' || block.resolution === 'both' ? 'ring-1 ring-inset ring-success/60' : '',
                      )}
                    >
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-success">
                        Incoming {block.incomingLabel && `(${block.incomingLabel})`}
                      </p>
                      <pre className="whitespace-pre-wrap font-mono text-xs leading-5">{block.incoming.join('\n')}</pre>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 border-t border-border-subtle bg-surface-raised/60 px-2 py-1.5">
                    <Button
                      variant={block.resolution === 'current' ? 'default' : 'secondary'}
                      size="sm"
                      onClick={() => setResolution(index, 'current')}
                    >
                      <ArrowLeft className="size-3" /> Accept current
                    </Button>
                    <Button
                      variant={block.resolution === 'incoming' ? 'default' : 'secondary'}
                      size="sm"
                      onClick={() => setResolution(index, 'incoming')}
                    >
                      Accept incoming <ArrowRight className="size-3" />
                    </Button>
                    <Button
                      variant={block.resolution === 'both' ? 'default' : 'secondary'}
                      size="sm"
                      onClick={() => setResolution(index, 'both')}
                    >
                      <Combine className="size-3" /> Accept both
                    </Button>
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

          {/* Result pane */}
          <div className="flex min-h-0 flex-1 flex-col">
            <p className="border-b border-border-subtle bg-surface px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
              Result
            </p>
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap px-4 py-2 font-mono text-xs leading-5">
              {resultPreview}
            </pre>
          </div>
        </div>
      )}
    </motion.div>
  );
}
