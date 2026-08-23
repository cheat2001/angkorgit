import { describe, expect, it } from 'vitest';
import { parseAiTextSegments } from '@angkorgit/core';

describe('parseAiTextSegments', () => {
  it('parses bold and code tokens between plain text', () => {
    expect(parseAiTextSegments('a **b** and `c` end')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'bold', text: 'b' },
      { kind: 'text', text: ' and ' },
      { kind: 'code', text: 'c' },
      { kind: 'text', text: ' end' },
    ]);
  });

  it('handles adjacent tokens and token-then-text without separators', () => {
    expect(parseAiTextSegments('**a**b`c`')).toEqual([
      { kind: 'bold', text: 'a' },
      { kind: 'text', text: 'b' },
      { kind: 'code', text: 'c' },
    ]);
  });

  it('keeps unclosed markers literal', () => {
    expect(parseAiTextSegments('**open and `open')).toEqual([
      { kind: 'text', text: '**open and `open' },
    ]);
  });

  it('keeps bold spans with inner asterisks literal', () => {
    expect(parseAiTextSegments('**has * inside**')).toEqual([
      { kind: 'text', text: '**has * inside**' },
    ]);
  });

  it('never spans tokens across newlines', () => {
    expect(parseAiTextSegments('**line1\nline2**')).toEqual([
      { kind: 'text', text: '**line1\nline2**' },
    ]);
    expect(parseAiTextSegments('`code\nmore`')).toEqual([{ kind: 'text', text: '`code\nmore`' }]);
  });

  it('treats asterisks inside backticks as code content', () => {
    expect(parseAiTextSegments('`a ** b`')).toEqual([{ kind: 'code', text: 'a ** b' }]);
  });

  it('keeps empty and marker-only strings literal', () => {
    expect(parseAiTextSegments('')).toEqual([]);
    expect(parseAiTextSegments('****')).toEqual([{ kind: 'text', text: '****' }]);
    expect(parseAiTextSegments('``')).toEqual([{ kind: 'text', text: '``' }]);
  });
});
