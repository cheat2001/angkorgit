import { useMemo } from 'react';
import { Pencil } from 'lucide-react';
import { Badge, cn } from '@angkorgit/design-system';
import { useRepo } from '@/features/repository/store';
import { REF_COL_WIDTH } from './GraphRow';
import { useGraph } from './store';
import { useUi } from '@/features/ui/store';

export function WipRow({ gutterWidth, flat }: { gutterWidth: number; flat?: boolean }) {
  const status = useRepo((s) => s.status);
  const conflicts = useRepo((s) => s.conflicts);
  const select = useGraph((s) => s.select);
  const selectedOid = useGraph((s) => s.selectedOid);
  const closeCenterDiff = useUi((s) => s.closeCenterDiff);

  const counts = useMemo(() => {
    const files = status?.files ?? [];
    return {
      total: files.length,
      staged: files.filter((f) => f.staged).length,
      unstaged: files.filter((f) => f.unstaged).length,
      conflicted: conflicts.length,
    };
  }, [status, conflicts]);

  if (counts.total === 0) return null;

  const focusWorkingCopy = () => {
    select(null); // inspector falls back to the working-copy panel
    closeCenterDiff();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${counts.total} uncommitted file change${counts.total === 1 ? '' : 's'} — view working copy`}
      onClick={focusWorkingCopy}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') focusWorkingCopy();
      }}
      className={cn(
        'sticky top-0 z-10 flex h-9 cursor-pointer select-none items-center gap-2 border-b border-dashed border-primary/40 pl-1 pr-2 text-sm',
        'bg-surface/95 backdrop-blur-sm transition-colors hover:bg-primary/10',
        selectedOid === null && 'bg-primary/10',
      )}
    >
      {!flat && <span className="h-full shrink-0" style={{ width: REF_COL_WIDTH }} />}
      <svg width={gutterWidth} height={36} className="shrink-0" aria-hidden>
        {!flat && (
          <line x1={10} y1={18} x2={10} y2={36} stroke="hsl(var(--primary))" strokeWidth={2} strokeDasharray="3 3" />
        )}
        <circle
          cx={flat ? gutterWidth / 2 : 10}
          cy={18}
          r={4.5}
          fill="hsl(var(--surface))"
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          strokeDasharray="3 2.5"
        />
      </svg>
      <Pencil className="size-3.5 shrink-0 text-primary" />
      <span className="font-mono text-xs text-primary">// WIP</span>
      <span className="min-w-0 truncate text-muted">
        {counts.total} uncommitted change{counts.total === 1 ? '' : 's'}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1">
        {counts.conflicted > 0 && <Badge tone="danger">{counts.conflicted} conflicted</Badge>}
        {counts.staged > 0 && <Badge tone="success">{counts.staged} staged</Badge>}
        {counts.unstaged > 0 && <Badge tone="info">{counts.unstaged} modified</Badge>}
        <span className="rounded-md border border-primary/40 px-2 py-0.5 text-[11px] font-medium text-primary">
          View changes
        </span>
      </span>
    </div>
  );
}
