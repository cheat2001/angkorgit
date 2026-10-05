export interface TabLabel {
  name: string;
  hint: string | null;
}

const segmentsOf = (path: string) => path.split(/[\\/]/).filter(Boolean);

export function tabLabels(paths: string[]): Map<string, TabLabel> {
  const labels = new Map<string, TabLabel>();
  const groups = new Map<string, string[]>();
  for (const path of paths) {
    const segments = segmentsOf(path);
    const name = segments[segments.length - 1] ?? path;
    labels.set(path, { name, hint: null });
    const key = name.toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), path]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const parents = group.map((path) => segmentsOf(path).slice(0, -1));
    const deepest = Math.max(...parents.map((p) => p.length));
    for (let depth = 1; depth <= Math.max(deepest, 1); depth++) {
      const hints = parents.map((p) => p.slice(-depth).join('/'));
      const unique = new Set(hints.map((h) => h.toLowerCase())).size === hints.length;
      if (unique || depth >= deepest) {
        group.forEach((path, i) => {
          const label = labels.get(path);
          if (label) label.hint = hints[i] || null;
        });
        break;
      }
    }
  }
  return labels;
}
