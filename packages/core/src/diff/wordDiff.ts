/** Word-level diff between two lines, via LCS over word tokens. */

export interface WordSegment {
  text: string;
  kind: 'equal' | 'added' | 'removed';
}

function tokenize(line: string): string[] {
  // Split into words, whitespace runs, and punctuation so highlights stay tight.
  return line.match(/\w+|\s+|[^\w\s]/g) ?? [];
}

export function wordDiff(oldLine: string, newLine: string): {
  old: WordSegment[];
  new: WordSegment[];
} {
  const a = tokenize(oldLine);
  const b = tokenize(newLine);

  // LCS dynamic programming table.
  const m = a.length;
  const n = b.length;
  const dp: Uint32Array = new Uint32Array((m + 1) * (n + 1));
  const at = (i: number, j: number) => dp[i * (n + 1) + j];

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i * (n + 1) + j] =
        a[i] === b[j]
          ? at(i + 1, j + 1) + 1
          : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }

  const oldSegs: WordSegment[] = [];
  const newSegs: WordSegment[] = [];
  let i = 0;
  let j = 0;
  const push = (arr: WordSegment[], text: string, kind: WordSegment['kind']) => {
    const last = arr[arr.length - 1];
    if (last && last.kind === kind) last.text += text;
    else arr.push({ text, kind });
  };

  while (i < m && j < n) {
    if (a[i] === b[j]) {
      push(oldSegs, a[i], 'equal');
      push(newSegs, b[j], 'equal');
      i++;
      j++;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      push(oldSegs, a[i], 'removed');
      i++;
    } else {
      push(newSegs, b[j], 'added');
      j++;
    }
  }
  while (i < m) push(oldSegs, a[i++], 'removed');
  while (j < n) push(newSegs, b[j++], 'added');

  return { old: oldSegs, new: newSegs };
}
