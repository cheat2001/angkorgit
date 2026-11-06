import { useMemo } from 'react';
import { Pencil } from 'lucide-react';
import { Badge, cn } from '@angkorgit/design-system';
import { useRepo } from '@/features/repository/store';
import { GUTTER_GAP, laneX, REF_COL_WIDTH } from './GraphRow';
import { useGraph } from './store';
import { useUi } from '@/features/ui/store';

export function WipRow({
  gutterWidth,
  showRefs = true,
}: {
  gutterWidth: number;
  showRefs?: boolean;
}) {
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
    select(null);
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
        'sticky top-0 z-10 flex h-9 cursor-pointer select-none items-center gap-2 border-b border-dashed border-primary/40 pr-4 text-sm',
        showRefs ? 'pl-1' : 'pl-4',
        'bg-surface transition-colors hover:[background-image:linear-gradient(hsl(var(--primary)/0.1),hsl(var(--primary)/0.1))]',
        selectedOid === null && '[background-image:linear-gradient(hsl(var(--primary)/0.1),hsl(var(--primary)/0.1))]',
      )}
    >
      {showRefs && <span className="h-full shrink-0" style={{ width: REF_COL_WIDTH }} />}
      <svg width={gutterWidth} height={36} className="shrink-0" style={{ marginRight: GUTTER_GAP }} aria-hidden>
        <line x1={laneX(0)} y1={18} x2={laneX(0)} y2={36} stroke="hsl(var(--primary))" strokeWidth={2} strokeDasharray="3 3" />
        <circle
          cx={laneX(0)}
          cy={18}
          r={4.5}
          fill="hsl(var(--surface))"
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          strokeDasharray="3 2.5"
        />
      </svg>
      <Pencil className="size-3.5 shrink-0 text-primary" />
      <span className="rounded border border-dashed border-primary/50 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-primary">
        WIP
      </span>
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
