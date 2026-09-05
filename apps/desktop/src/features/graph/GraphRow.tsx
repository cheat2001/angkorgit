import { memo } from 'react';
import type { GraphRow as GraphRowData, RefInfo } from '@angkorgit/core';
import { Badge, cn } from '@angkorgit/design-system';
import { Check, Cloud, GitMerge, Monitor, Tag as TagIcon, FolderTree } from 'lucide-react';
import type { CommitInfo } from '@angkorgit/core';
import { Avatar } from '@/components/Avatar';
import { toast } from 'sonner';
import { formatDate, timeAgo } from '@/shared/utils';
import { DEFAULT_GRAPH_COLUMNS, type GraphColumns } from '@/features/ui/store';

export const ROW_HEIGHT = 32;
export const REF_COL_WIDTH = 150;
const FLAT_REF_WIDTH = 224;
const OVERFLOW_BADGE_WIDTH = 34;
const CHAR_WIDTH = 6.4;
const CHIP_PADDING = 18;
const CHIP_ICON = 14;
export const FLAT_GUTTER_WIDTH = 28;
const LANE_WIDTH = 14;
const NODE_RADIUS = 4;
const AVATAR_SIZE = 18;

export function laneColor(color: number): string {
  return `hsl(var(--graph-${color % 10}))`;
}

export const laneX = (lane: number) => AVATAR_SIZE / 2 + 3 + lane * LANE_WIDTH;
const x = laneX;
const CY = ROW_HEIGHT / 2;

function FlatGutter({ author }: { author: CommitInfo['author'] }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center"
      style={{ width: FLAT_GUTTER_WIDTH, height: ROW_HEIGHT }}
    >
      <span
        className="overflow-hidden rounded-full"
        title={author.name}
        style={{
          width: AVATAR_SIZE,
          height: AVATAR_SIZE,
          boxShadow: '0 0 0 1px hsl(var(--border))',
          background: 'hsl(var(--surface))',
        }}
      >
        <Avatar name={author.name} email={author.email} size={AVATAR_SIZE} />
      </span>
    </div>
  );
}

function GraphGutter({
  row,
  width,
  author,
  hasRefs,
  showAuthor,
}: {
  row: GraphRowData;
  width: number;
  author: CommitInfo['author'];
  hasRefs: boolean;
  showAuthor: boolean;
}) {
  const { node, passing } = row;
  const nx = Math.min(x(node.lane), width - AVATAR_SIZE / 2 - 2);
  return (
    <div className="relative shrink-0 overflow-hidden" style={{ width, height: ROW_HEIGHT }}>
      <svg width={width} height={ROW_HEIGHT} aria-hidden>
        {hasRefs && (
          <line
            x1={0}
            y1={CY}
            x2={nx}
            y2={CY}
            stroke={laneColor(node.color)}
            strokeOpacity={0.45}
            strokeWidth={1}
          />
        )}
        {passing.map((p) => (
          <line
            key={`p${p.lane}`}
            x1={x(p.lane)}
            y1={0}
            x2={x(p.lane)}
            y2={ROW_HEIGHT}
            stroke={laneColor(p.color)}
            strokeWidth={2}
          />
        ))}
        {node.closing.map((c) => (
          <path
            key={`c${c.lane}`}
            d={`M ${x(c.lane)} 0 C ${x(c.lane)} ${CY}, ${nx} ${CY * 0.4}, ${nx} ${CY}`}
            stroke={laneColor(c.color)}
            strokeWidth={2}
            fill="none"
          />
        ))}
        {node.merges.map((m) => (
          <path
            key={`m${m.lane}`}
            d={`M ${nx} ${CY} C ${x(m.lane)} ${CY * 1.6}, ${x(m.lane)} ${CY}, ${x(m.lane)} ${ROW_HEIGHT}`}
            stroke={laneColor(m.color)}
            strokeWidth={2}
            fill="none"
          />
        ))}
        {node.hasIncoming && (
          <line x1={nx} y1={0} x2={nx} y2={CY} stroke={laneColor(node.color)} strokeWidth={2} />
        )}
        {node.continues && (
          <line x1={nx} y1={CY} x2={nx} y2={ROW_HEIGHT} stroke={laneColor(node.color)} strokeWidth={2} />
        )}
        {node.isMerge && (
          <circle
            cx={nx}
            cy={CY}
            r={NODE_RADIUS - 0.5}
            fill="hsl(var(--surface))"
            stroke={laneColor(node.color)}
            strokeWidth={2}
          />
        )}
        {!node.isMerge && !showAuthor && (
          <circle cx={nx} cy={CY} r={NODE_RADIUS} fill={laneColor(node.color)} />
        )}
      </svg>
      {!node.isMerge && showAuthor && (
        <span
          className="absolute overflow-hidden rounded-full"
          title={author.name}
          style={{
            left: nx - AVATAR_SIZE / 2,
            top: CY - AVATAR_SIZE / 2,
            width: AVATAR_SIZE,
            height: AVATAR_SIZE,
            boxShadow: `0 0 0 2px ${laneColor(node.color)}`,
            background: 'hsl(var(--surface))',
          }}
        >
          <Avatar name={author.name} email={author.email} size={AVATAR_SIZE} />
        </span>
      )}
    </div>
  );
}

export interface RefGroup {
  label: string;
  primary: RefInfo;
  local: boolean;
  remote: boolean;
  tag: boolean;
  detachedHead: boolean;
}

const groupRank = (g: RefGroup) => (g.detachedHead ? 0 : g.local ? 1 : g.remote ? 2 : 3);

export function groupRefs(refs: RefInfo[]): RefGroup[] {
  const out: RefGroup[] = [];
  const index = new Map<string, number>();
  const hasLocal = refs.some((r) => r.kind === 'localBranch');
  for (const ref of refs) {
    if (ref.kind === 'head') {
      if (!hasLocal) {
        out.push({ label: 'HEAD', primary: ref, local: false, remote: false, tag: false, detachedHead: true });
      }
    } else if (ref.kind === 'localBranch') {
      const i = index.get(ref.shorthand);
      if (i !== undefined) {
        out[i].local = true;
        out[i].primary = ref;
      } else {
        index.set(ref.shorthand, out.length);
        out.push({ label: ref.shorthand, primary: ref, local: true, remote: false, tag: false, detachedHead: false });
      }
    } else if (ref.kind === 'remoteBranch') {
      const base = ref.shorthand.split('/').slice(1).join('/') || ref.shorthand;
      const i = index.get(base);
      if (i !== undefined) {
        out[i].remote = true;
      } else {
        index.set(base, out.length);
        out.push({ label: base, primary: ref, local: false, remote: true, tag: false, detachedHead: false });
      }
    } else {
      out.push({ label: ref.shorthand, primary: ref, local: false, remote: false, tag: true, detachedHead: false });
    }
  }
  return out.sort((a, b) => groupRank(a) - groupRank(b));
}

export function estimateChipWidth(group: RefGroup, head: boolean): number {
  const icons = (group.local ? 1 : 0) + (group.remote ? 1 : 0) + (group.tag ? 1 : 0) + (head || group.detachedHead ? 1 : 0);
  return Math.round(group.label.length * CHAR_WIDTH + CHIP_PADDING + icons * CHIP_ICON);
}

function fitGroups(groups: RefGroup[], available: number, isHead: boolean): RefGroup[] {
  if (groups.length <= 1) return groups;
  const shown: RefGroup[] = [];
  let used = 0;
  for (let i = 0; i < groups.length; i += 1) {
    const width = estimateChipWidth(groups[i], isHead && shown.length === 0 && groups[i].local);
    const remainingAfter = groups.length - (i + 1);
    const reserve = remainingAfter > 0 ? OVERFLOW_BADGE_WIDTH : 0;
    if (shown.length > 0 && used + 4 + width + reserve > available) break;
    shown.push(groups[i]);
    used += (shown.length > 1 ? 4 : 0) + width;
  }
  return shown;
}



function RefCell({
  refs,
  isHead,
  color,
  flat,
  width,
  worktrees,
  onCheckoutRef,
  onRefMenu,
}: {
  refs: RefInfo[];
  isHead: boolean;
  color: number;
  flat?: boolean;
  width: number;
  worktrees?: ReadonlyMap<string, string>;
  onCheckoutRef: (ref: RefInfo) => void;
  onRefMenu: (event: React.MouseEvent, ref: RefInfo) => void;
}) {
  const groups = groupRefs(refs);
  let headMarked = false;
  if (flat && groups.length === 0) return null;
  const shown = fitGroups(groups, (flat ? FLAT_REF_WIDTH : width) - 8, isHead);
  const hidden = groups.slice(shown.length);
  return (
    <span
      className={cn(
        'flex h-full shrink-0 items-center gap-1',
        flat ? 'max-w-56' : '-mr-2',
      )}
      style={flat ? undefined : { width }}
    >
      {shown.map((group) => {
        const head = (isHead && group.local && !headMarked) || group.detachedHead;
        if (head) headMarked = true;
        const worktree = group.local ? worktrees?.get(group.label) : undefined;
        return (
          <Badge
            key={group.primary.name}
            tone={group.tag || group.detachedHead ? 'primary' : group.local ? 'success' : 'info'}
            className={cn(
              'min-w-0 shrink whitespace-nowrap',
              !group.tag &&
                'cursor-pointer hover:z-20 hover:shrink-0 hover:!bg-surface-overlay hover:shadow-soft',
            )}
            title={
              group.tag || group.detachedHead
                ? group.detachedHead
                  ? 'HEAD is detached at this commit'
                  : group.label
                : `${group.label}${group.local ? ' · local' : ''}${group.remote ? ' · origin' : ''}${worktree ? ` · in worktree ${worktree}` : ''} — ${worktree ? 'double-click to switch to that worktree' : 'double-click to checkout'}, right-click for actions`
            }
            onDoubleClick={(e) => {
              if (group.tag || group.detachedHead) return;
              e.stopPropagation();
              onCheckoutRef(group.primary);
            }}
            onContextMenu={(e) => {
              if (group.detachedHead) return;
              e.preventDefault();
              e.stopPropagation();
              onRefMenu(e, group.primary);
            }}
          >
            {head && <Check className="size-2.5 shrink-0" />}
            {group.tag && <TagIcon className="size-2.5 shrink-0" />}
            <span className="truncate">{group.label}</span>
            {group.local && !worktree && <Monitor className="size-2.5 shrink-0" />}
            {worktree && <FolderTree className="size-2.5 shrink-0" />}
            {group.remote && <Cloud className="size-2.5 shrink-0" />}
          </Badge>
        );
      })}
      {hidden.length > 0 && (
        <Badge className="shrink-0" title={hidden.map((g) => g.label).join(', ')}>
          +{hidden.length}
        </Badge>
      )}
      {!flat && groups.length > 0 && (
        <span
          className="h-px min-w-1 flex-1"
          style={{ background: laneColor(color), opacity: 0.45 }}
        />
      )}
    </span>
  );
}

interface Props {
  commit: CommitInfo;
  row: GraphRowData;
  gutterWidth: number;
  flat?: boolean;
  selected: boolean;
  columns?: GraphColumns;
  worktrees?: ReadonlyMap<string, string>;
  onSelect: (oid: string, event: React.MouseEvent) => void;
  onContextMenu: (event: React.MouseEvent, commit: CommitInfo) => void;
  onCheckoutRef: (ref: RefInfo) => void;
  onRefMenu: (event: React.MouseEvent, ref: RefInfo, commit: CommitInfo) => void;
}

export const CommitRow = memo(function CommitRow({
  commit,
  row,
  gutterWidth,
  flat,
  selected,
  columns = DEFAULT_GRAPH_COLUMNS,
  worktrees,
  onSelect,
  onContextMenu,
  onCheckoutRef,
  onRefMenu,
}: Props) {
  const isMergeCommit = commit.parents.length > 1;
  const refCell = columns.refs ? (
    <RefCell
      refs={commit.refs}
      isHead={commit.isHead}
      color={row.node.color}
      flat={flat}
      width={REF_COL_WIDTH}
      worktrees={worktrees}
      onCheckoutRef={onCheckoutRef}
      onRefMenu={(e, ref) => onRefMenu(e, ref, commit)}
    />
  ) : null;
  return (
    <div
      role="row"
      aria-selected={selected}
      className={cn(
        'flex h-8 cursor-pointer select-none items-center gap-2 pl-1 pr-2 text-sm transition-colors',
        selected ? 'bg-primary/10' : 'hover:bg-surface-raised',
        commit.isHead && 'font-medium',
      )}
      onClick={(e) => onSelect(commit.oid, e)}
      onContextMenu={(e) => onContextMenu(e, commit)}
    >
      {!flat && refCell}
      {flat ? (
        columns.author && <FlatGutter author={commit.author} />
      ) : (
        <GraphGutter
          row={row}
          width={gutterWidth}
          author={commit.author}
          hasRefs={columns.refs && commit.refs.length > 0}
          showAuthor={columns.author}
        />
      )}
      {flat && refCell}
      {commit.isHead && commit.refs.length === 0 && <Badge tone="primary">HEAD</Badge>}
      {isMergeCommit && <GitMerge className="size-3.5 shrink-0 text-faint" />}
      <span className={cn('min-w-0 flex-1 truncate', isMergeCommit && !selected && 'text-muted')}>
        {commit.summary || <span className="text-faint">(no message)</span>}
      </span>
      {columns.hash && (
      <button
        type="button"
        className="w-14 shrink-0 rounded px-0.5 text-right font-mono text-[11px] text-faint hover:bg-surface-raised hover:text-foreground"
        title="Copy full hash"
        onClick={(e) => {
          e.stopPropagation();
          void navigator.clipboard.writeText(commit.oid);
          toast.success('Commit hash copied');
        }}
      >
        {commit.shortOid.slice(0, 7)}
      </button>
      )}
      {columns.date && (
      <span
        className="w-[4.5rem] shrink-0 whitespace-nowrap text-right text-[11px] text-faint"
        title={formatDate(commit.author.time)}
      >
        {timeAgo(commit.author.time)}
      </span>
      )}
    </div>
  );
});
