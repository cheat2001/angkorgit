import { memo, useState } from 'react';
import type { GraphRow as GraphRowData, RefInfo } from '@angkorgit/core';
import { Badge, HoverCard, HoverCardContent, HoverCardTrigger, cn } from '@angkorgit/design-system';
import { Archive, Check, Cloud, GitMerge, Monitor, Tag as TagIcon, FolderTree } from 'lucide-react';
import type { CommitInfo } from '@angkorgit/core';
import { Avatar } from '@/components/Avatar';
import { toast } from 'sonner';
import { formatDate, timeAgo } from '@/shared/utils';
import { DEFAULT_GRAPH_COLUMNS, type GraphColumns } from '@/features/ui/store';

export const ROW_HEIGHT = 32;
export const REF_COL_WIDTH = 150;
export const GUTTER_GAP = 10;
export const AUTHOR_COL_WIDTH = 112;
const OVERFLOW_BADGE_WIDTH = 34;
const REF_STACK_SIDE_OFFSET = -ROW_HEIGHT;
const REF_STACK_ALIGN_OFFSET = -5;
const CHAR_WIDTH = 6.4;
const CHIP_PADDING = 18;
const CHIP_ICON = 14;
export const LANE_WIDTH = 22;
export const GUTTER_MAX_WIDTH = 250;
export const GUTTER_BASE = 18;
const NODE_RADIUS = 4;
const AVATAR_SIZE = 20;
const TAIL_HEIGHT = 22;
const TAIL_EDGE = 2;
const NODE_RING = 2;
const NODE_HALO = 1.5;

export function laneColor(color: number): string {
  return `hsl(var(--graph-${color % 10}))`;
}

const laneTint = (color: number, alpha: number) => `hsl(var(--graph-${color % 10}) / ${alpha})`;

export const laneX = (lane: number, laneWidth: number = LANE_WIDTH) =>
  AVATAR_SIZE / 2 + NODE_RING + NODE_HALO + 1 + lane * laneWidth;

export function GraphTailDefs() {
  return (
    <svg width={0} height={0} className="absolute" aria-hidden>
      <defs>
        {Array.from({ length: 10 }, (_, i) => (
          <linearGradient key={i} id={`graph-tail-${i}`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor={laneColor(i)} style={{ stopOpacity: 'var(--graph-tail-start)' }} />
            <stop offset="0.55" stopColor={laneColor(i)} style={{ stopOpacity: 'var(--graph-tail-mid)' }} />
            <stop offset="1" stopColor={laneColor(i)} style={{ stopOpacity: 'var(--graph-tail-end)' }} />
          </linearGradient>
        ))}
      </defs>
    </svg>
  );
}

export function gutterWidthFor(maxLane: number, laneWidth: number = LANE_WIDTH): number {
  return Math.min(GUTTER_BASE + (maxLane + 1) * laneWidth, GUTTER_MAX_WIDTH);
}

export function gutterOverflowFor(maxLane: number, laneWidth: number = LANE_WIDTH): number {
  return Math.max(0, GUTTER_BASE + (maxLane + 1) * laneWidth - gutterWidthFor(maxLane, laneWidth));
}

export const GRAPH_SCROLL_VAR = '--graph-scroll-x';
export const graphShift = { transform: `translateX(calc(var(${GRAPH_SCROLL_VAR}, 0px) * -1))` } as const;
const CY = ROW_HEIGHT / 2;
const RAIL_RADIUS = 6;

function railIn(from: number, to: number): string {
  if (from === to) return `M ${from} 0 V ${CY}`;
  const r = Math.min(RAIL_RADIUS, Math.abs(to - from));
  const s = to > from ? 1 : -1;
  return `M ${from} 0 V ${CY - r} Q ${from} ${CY} ${from + s * r} ${CY} H ${to}`;
}

function railOut(from: number, to: number): string {
  if (from === to) return `M ${from} ${CY} V ${ROW_HEIGHT}`;
  const r = Math.min(RAIL_RADIUS, Math.abs(to - from));
  const s = to > from ? 1 : -1;
  return `M ${from} ${CY} H ${to - s * r} Q ${to} ${CY} ${to} ${CY + r} V ${ROW_HEIGHT}`;
}

function StashNode({ color }: { color?: number }) {
  return (
    <span
      role="img"
      aria-label="Stash"
      className="flex items-center justify-center"
      style={{
        width: AVATAR_SIZE,
        height: AVATAR_SIZE,
        color: color === undefined ? 'hsl(var(--muted-foreground))' : laneColor(color),
      }}
    >
      <Archive className="size-3" />
    </span>
  );
}


function GraphGutter({
  row,
  width,
  laneWidth,
  author,
  oid,
  hasRefs,
  isStash,
  showTail,
  overflow,
}: {
  row: GraphRowData;
  width: number;
  laneWidth: number;
  author: CommitInfo['author'];
  oid: string;
  hasRefs: boolean;
  isStash: boolean;
  showTail: boolean;
  overflow: number;
}) {
  const { node, passing } = row;
  const x = (lane: number) => laneX(lane, laneWidth);
  const nx = x(node.lane);
  const total = width + GUTTER_GAP;
  return (
    <div className="relative shrink-0 overflow-hidden" style={{ width: total, height: ROW_HEIGHT }}>
      <svg width={total} height={ROW_HEIGHT} aria-hidden>
        <g style={graphShift}>
        {showTail && (
          <rect
            data-graph-tail
            x={nx}
            y={CY - TAIL_HEIGHT / 2}
            width={Math.max(0, total - nx + overflow)}
            height={TAIL_HEIGHT}
            fill={`url(#graph-tail-${node.color % 10})`}
          />
        )}
        {hasRefs && (
          <line
            data-graph-connector
            x1={-overflow - 1}
            y1={CY}
            x2={nx}
            y2={CY}
            stroke={laneColor(node.color)}
            strokeOpacity={0.85}
            strokeWidth={1.5}
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
            d={railIn(x(c.lane), nx)}
            stroke={laneColor(c.color)}
            strokeWidth={2}
            fill="none"
          />
        ))}
        {node.merges.map((m) => (
          <path
            key={`m${m.lane}`}
            d={railOut(nx, x(m.lane))}
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
        </g>
        {showTail && (
          <rect
            data-graph-tail-edge
            x={total - TAIL_EDGE}
            y={2}
            width={TAIL_EDGE}
            height={ROW_HEIGHT - 4}
            fill={laneColor(node.color)}
          />
        )}
      </svg>
      {!node.isMerge && (
        <span
          className="absolute overflow-hidden rounded-full"
          title={isStash ? 'Stash' : author.name}
          style={{
            left: nx - AVATAR_SIZE / 2,
            top: CY - AVATAR_SIZE / 2,
            width: AVATAR_SIZE,
            height: AVATAR_SIZE,
            boxShadow: `0 0 0 ${NODE_HALO}px hsl(var(--background)), 0 0 0 ${NODE_HALO + NODE_RING}px ${laneColor(node.color)}`,
            background: 'hsl(var(--surface))',
            outline: isStash ? `1.5px dashed ${laneColor(node.color)}` : undefined,
            ...graphShift,
            outlineOffset: isStash ? -1.5 : undefined,
          }}
        >
          {isStash ? <StashNode color={node.color} /> : <Avatar name={author.name} email={author.email} oid={oid} size={AVATAR_SIZE} />}
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
  stash?: boolean;
}

const groupRank = (g: RefGroup, headBranch: string | null) =>
  g.detachedHead ? 0 : g.local ? (g.label === headBranch ? 1 : 2) : g.remote ? 3 : g.stash ? 5 : 4;

export function groupRefs(refs: RefInfo[], headBranch: string | null = null): RefGroup[] {
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
    } else if (ref.kind === 'stash') {
      out.push({ label: ref.shorthand, primary: ref, local: false, remote: false, tag: false, detachedHead: false, stash: true });
    } else {
      out.push({ label: ref.shorthand, primary: ref, local: false, remote: false, tag: true, detachedHead: false });
    }
  }
  return out.sort((a, b) => groupRank(a, headBranch) - groupRank(b, headBranch));
}

export function estimateChipWidth(group: RefGroup, head: boolean): number {
  const icons = (group.local ? 1 : 0) + (group.remote ? 1 : 0) + (group.tag ? 1 : 0) + (group.stash ? 1 : 0) + (head || group.detachedHead ? 1 : 0);
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



function RefChip({
  group,
  head,
  worktree,
  separated,
  color,
  onCheckoutRef,
  onRefMenu,
  onResetToRemote,
}: {
  group: RefGroup;
  head: boolean;
  worktree?: string;
  separated: boolean;
  color: number;
  onCheckoutRef: (ref: RefInfo) => void;
  onRefMenu: (event: React.MouseEvent, ref: RefInfo) => void;
  onResetToRemote: (ref: RefInfo) => void;
}) {
  const laneStyle = group.stash
    ? undefined
    : head
      ? { background: laneColor(color), borderColor: laneColor(color), color: 'hsl(var(--background))' }
      : { background: laneTint(color, 0.16), borderColor: laneTint(color, 0.45), color: laneColor(color) };
  return (
    <Badge
      tone="neutral"
      data-lane-chip={group.stash ? undefined : color % 10}
      style={laneStyle}
      className={cn(
        'min-w-0 shrink whitespace-nowrap',
        !group.tag && !group.stash && !head &&
          'cursor-pointer hover:z-20 hover:shrink-0 hover:!bg-surface-overlay hover:shadow-soft',
        group.stash && 'max-w-[11rem] cursor-pointer border-dashed hover:!bg-surface-overlay',
        head && 'cursor-pointer shadow-soft hover:z-20 hover:shrink-0',
      )}
      title={
        group.stash
          ? `${group.label}\nStash — click the row to see its files, right-click to apply, pop or drop`
          : group.tag || group.detachedHead
          ? group.detachedHead
            ? 'HEAD is detached at this commit'
            : group.label
          : separated
            ? `${group.primary.shorthand} — double-click to reset ${group.label} to it, right-click for actions`
            : `${group.label}${group.local ? ' · local' : ''}${group.remote ? ' · origin' : ''}${worktree ? ` · in worktree ${worktree}` : ''} — ${worktree ? 'double-click to switch to that worktree' : group.local ? 'double-click to checkout' : `double-click to check out ${group.label} from it (fast-forwards the local branch when it is behind)`}, right-click for actions`
      }
      onDoubleClick={(e) => {
        if (group.tag || group.detachedHead || group.stash) return;
        e.stopPropagation();
        if (separated) onResetToRemote(group.primary);
        else onCheckoutRef(group.primary);
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
      {group.stash && <Archive className="size-2.5 shrink-0" />}
      <span className="truncate">{group.label}</span>
      {group.local && !worktree && <Monitor className="size-2.5 shrink-0" />}
      {worktree && <FolderTree className="size-2.5 shrink-0" />}
      {group.remote && <Cloud className="size-2.5 shrink-0" />}
    </Badge>
  );
}

const stopRowGestures = {
  onClick: (e: React.MouseEvent) => e.stopPropagation(),
  onDoubleClick: (e: React.MouseEvent) => e.stopPropagation(),
  onContextMenu: (e: React.MouseEvent) => e.stopPropagation(),
};

function RefCell({
  refs,
  isHead,
  color,
  width,
  headBranch = null,
  worktrees,
  resettableBranches,
  onCheckoutRef,
  onRefMenu,
  onResetToRemote,
}: {
  refs: RefInfo[];
  isHead: boolean;
  headBranch?: string | null;
  color: number;
  width: number;
  worktrees?: ReadonlyMap<string, string>;
  resettableBranches?: ReadonlySet<string>;
  onCheckoutRef: (ref: RefInfo) => void;
  onRefMenu: (event: React.MouseEvent, ref: RefInfo) => void;
  onResetToRemote: (ref: RefInfo) => void;
}) {
  const [more, setMore] = useState(false);
  const groups = groupRefs(refs, headBranch);
  const shown = fitGroups(groups, width - 8, isHead);
  const hidden = groups.slice(shown.length);
  const headOf = (list: RefGroup[]) => {
    let marked = false;
    return list.map((group) => {
      const head =
        group.detachedHead ||
        (isHead && group.local && (headBranch ? group.label === headBranch : !marked));
      if (head) marked = true;
      return head;
    });
  };
  const chip = (group: RefGroup, head: boolean) => (
    <RefChip
      key={group.primary.name}
      group={group}
      head={head}
      worktree={group.local ? worktrees?.get(group.label) : undefined}
      color={color}
      separated={group.remote && !group.local && (resettableBranches?.has(group.label) ?? false)}
      onCheckoutRef={onCheckoutRef}
      onRefMenu={onRefMenu}
      onResetToRemote={onResetToRemote}
    />
  );
  const shownHeads = headOf(shown);
  const cell = (
    <span className="-mr-2 flex h-full shrink-0 items-center gap-1" style={{ width }}>
      {shown.map((group, i) => chip(group, shownHeads[i]))}
      {hidden.length > 0 && (
        <Badge
          role="button"
          aria-label={`${hidden.length} more ${hidden.length === 1 ? 'ref' : 'refs'}`}
          aria-expanded={more}
          className="shrink-0 cursor-pointer hover:!bg-surface-overlay"
          title={hidden.map((g) => g.label).join(', ')}
          onClick={(e) => {
            e.stopPropagation();
            setMore(true);
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMore(true);
          }}
        >
          +{hidden.length}
        </Badge>
      )}
      {groups.length > 0 && (
        <span
          className="h-px min-w-1 flex-1"
          style={{ background: laneColor(color), opacity: 0.85, height: 1.5 }}
        />
      )}
    </span>
  );
  if (hidden.length === 0) return cell;
  const allHeads = headOf(groups);
  return (
    <HoverCard open={more} onOpenChange={setMore} openDelay={200} closeDelay={150}>
      <HoverCardTrigger asChild>{cell}</HoverCardTrigger>
      <HoverCardContent
        side="bottom"
        align="start"
        sideOffset={REF_STACK_SIDE_OFFSET}
        alignOffset={REF_STACK_ALIGN_OFFSET}
        data-more-refs
        className="flex flex-col items-start gap-1 p-1"
        {...stopRowGestures}
      >
        {groups.map((group, i) => chip(group, allHeads[i]))}
      </HoverCardContent>
    </HoverCard>
  );
}

interface Props {
  commit: CommitInfo;
  row: GraphRowData;
  gutterWidth: number;
  selected: boolean;
  laneWidth?: number;
  columns?: GraphColumns;
  showTail?: boolean;
  graphOverflow?: number;
  headBranch?: string | null;
  worktrees?: ReadonlyMap<string, string>;
  resettableBranches?: ReadonlySet<string>;
  onSelect: (oid: string, event: React.MouseEvent) => void;
  onContextMenu: (event: React.MouseEvent, commit: CommitInfo) => void;
  onCheckoutRef: (ref: RefInfo) => void;
  onRefMenu: (event: React.MouseEvent, ref: RefInfo, commit: CommitInfo) => void;
  onResetToRemote: (ref: RefInfo, commit: CommitInfo) => void;
}

export const CommitRow = memo(function CommitRow({
  commit,
  row,
  gutterWidth,
  selected,
  laneWidth = LANE_WIDTH,
  columns = DEFAULT_GRAPH_COLUMNS,
  showTail = true,
  graphOverflow = 0,
  headBranch = null,
  worktrees,
  resettableBranches,
  onSelect,
  onContextMenu,
  onCheckoutRef,
  onRefMenu,
  onResetToRemote,
}: Props) {
  const isMergeCommit = commit.parents.length > 1;
  const isStash = commit.refs.some((ref) => ref.kind === 'stash');
  const refCell = columns.refs ? (
    <RefCell
      refs={commit.refs}
      isHead={commit.isHead}
      headBranch={headBranch}
      color={row.node.color}
      width={REF_COL_WIDTH}
      worktrees={worktrees}
      resettableBranches={resettableBranches}
      onCheckoutRef={onCheckoutRef}
      onRefMenu={(e, ref) => onRefMenu(e, ref, commit)}
      onResetToRemote={(ref) => onResetToRemote(ref, commit)}
    />
  ) : null;
  return (
    <div
      role="row"
      aria-selected={selected}
      className={cn(
        'flex h-8 cursor-pointer select-none items-center gap-2 pr-4 text-sm transition-colors',
        columns.refs ? 'pl-1' : 'pl-4',
        selected ? 'bg-primary/10' : 'hover:bg-surface-raised',
        commit.isHead && 'font-medium',
      )}
      onClick={(e) => onSelect(commit.oid, e)}
      onContextMenu={(e) => onContextMenu(e, commit)}
    >
      {refCell}
      <GraphGutter
        row={row}
        width={gutterWidth}
        laneWidth={laneWidth}
        author={commit.author}
        oid={commit.oid}
        hasRefs={columns.refs && commit.refs.length > 0}
        isStash={isStash}
        showTail={showTail}
        overflow={graphOverflow}
      />
      {commit.isHead && commit.refs.length === 0 && <Badge tone="primary">HEAD</Badge>}
      {columns.message ? (
        <>
          {isMergeCommit && <GitMerge className="size-3.5 shrink-0 text-faint" />}
          <span className={cn('min-w-0 flex-1 truncate', isMergeCommit && !selected && 'text-muted')}>
            {commit.summary || <span className="text-faint">(no message)</span>}
          </span>
        </>
      ) : null}
      {columns.author && (
        <span
          className="shrink-0 truncate text-[11px] text-muted"
          style={{ width: AUTHOR_COL_WIDTH }}
          title={`${commit.author.name} <${commit.author.email}>`}
        >
          {commit.author.name}
        </span>
      )}
      {columns.hash && (
      <button
        type="button"
        className={cn(
          'w-14 shrink-0 rounded px-0.5 font-mono text-[11px] text-faint hover:bg-surface-raised hover:text-foreground',
          columns.message ? 'text-right' : 'text-left',
        )}
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
        className={cn(
          'w-[4.5rem] shrink-0 whitespace-nowrap text-[11px] text-faint',
          columns.message ? 'text-right' : 'text-left',
        )}
        title={formatDate(commit.author.time)}
      >
        {timeAgo(commit.author.time)}
      </span>
      )}
      {!columns.message && <span className="min-w-0 flex-1" />}
    </div>
  );
});
