import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Folder } from 'lucide-react';
import { cn } from '@angkorgit/design-system';
import { useUi } from '@/features/ui/store';

interface TreeFolder<T> {
  name: string;
  path: string;
  folders: TreeFolder<T>[];
  files: T[];
  count: number;
}

function buildFileTree<T>(items: T[], pathOf: (item: T) => string): TreeFolder<T> {
  interface Node {
    name: string;
    path: string;
    folders: Map<string, Node>;
    files: T[];
  }
  const root: Node = { name: '', path: '', folders: new Map(), files: [] };
  for (const item of items) {
    const parts = pathOf(item).split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const name = parts[i];
      let child = node.folders.get(name);
      if (!child) {
        child = {
          name,
          path: node.path ? `${node.path}/${name}` : name,
          folders: new Map(),
          files: [],
        };
        node.folders.set(name, child);
      }
      node = child;
    }
    node.files.push(item);
  }
  const finalize = (node: Node): TreeFolder<T> => {
    let current = node;
    let name = node.name;
    while (name !== '' && current.folders.size === 1 && current.files.length === 0) {
      const only = [...current.folders.values()][0];
      name = `${name}/${only.name}`;
      current = only;
    }
    const folders = [...current.folders.values()]
      .map(finalize)
      .sort((a, b) => a.name.localeCompare(b.name));
    const files = [...current.files].sort((a, b) => pathOf(a).localeCompare(pathOf(b)));
    return {
      name,
      path: current.path,
      folders,
      files,
      count: files.length + folders.reduce((sum, f) => sum + f.count, 0),
    };
  };
  return finalize(root);
}

function TreeLevel<T>({
  folder,
  depth,
  collapsed,
  onToggle,
  renderFile,
}: {
  folder: TreeFolder<T>;
  depth: number;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  renderFile: (item: T, depth: number) => React.ReactNode;
}) {
  return (
    <>
      {folder.folders.map((child) => (
        <div key={child.path}>
          <button
            type="button"
            className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-xs text-muted hover:bg-surface-raised"
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => onToggle(child.path)}
          >
            <ChevronRight
              className={cn('size-3 shrink-0 transition-transform', !collapsed.has(child.path) && 'rotate-90')}
            />
            <Folder className="size-3 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-left font-medium">{child.name}</span>
            <span className="text-[10px] text-faint">{child.count}</span>
          </button>
          {!collapsed.has(child.path) && (
            <TreeLevel
              folder={child}
              depth={depth + 1}
              collapsed={collapsed}
              onToggle={onToggle}
              renderFile={renderFile}
            />
          )}
        </div>
      ))}
      {folder.files.map((item) => renderFile(item, depth))}
    </>
  );
}

function folderPaths<T>(folder: TreeFolder<T>, into: string[] = []): string[] {
  for (const child of folder.folders) {
    into.push(child.path);
    folderPaths(child, into);
  }
  return into;
}

export function treeIndent(depth: number): number {
  return 8 + depth * 14 + 14;
}

export function FileTree<T>({
  items,
  pathOf,
  renderFile,
}: {
  items: T[];
  pathOf: (item: T) => string;
  renderFile: (item: T, depth: number) => React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const root = useMemo(() => buildFileTree(items, pathOf), [items, pathOf]);
  const fold = useUi((s) => s.fileTreeFold);
  useEffect(() => {
    if (fold.epoch === 0) return;
    setCollapsed(fold.mode === 'collapse' ? new Set(folderPaths(root)) : new Set());
  }, [fold, root]);
  const onToggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  return (
    <TreeLevel folder={root} depth={0} collapsed={collapsed} onToggle={onToggle} renderFile={renderFile} />
  );
}
