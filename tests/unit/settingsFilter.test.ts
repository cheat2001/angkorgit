import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { SETTINGS_CARDS, filterSettingsCards } from '@angkorgit/core';

describe('settings filter', () => {
  it('keeps catalog order for an empty filter', () => {
    expect(filterSettingsCards('  ')).toEqual(SETTINGS_CARDS);
  });

  it('matches titles and keywords case-insensitively with AND terms', () => {
    expect(filterSettingsCards('  SSH  AGENT ').map((card) => card.id)).toEqual(['ssh']);
    expect(filterSettingsCards('fetch interval').map((card) => card.id)).toEqual(['auto-fetch']);
    expect(filterSettingsCards('ssh zoom')).toEqual([]);
  });

  it('a section label matches every card in that section', () => {
    expect(filterSettingsCards('authentication')).toEqual(SETTINGS_CARDS.filter((card) => card.section === 'accounts'));
    expect(filterSettingsCards('git fetch').map((card) => card.id)).toEqual(['auto-fetch']);
    expect(filterSettingsCards('appearance')).toEqual(SETTINGS_CARDS.filter((card) => card.section === 'appearance'));
  });

  it('covers every rendered card and each possible title with exactly one catalog entry', () => {
    const directory = resolve('apps/desktop/src/features/settings');
    const sources = readdirSync(directory).filter((name) => name.endsWith('.tsx') && name !== 'SettingCard.tsx');
    const seen: string[] = [];
    for (const name of sources) {
      const source = readFileSync(resolve(directory, name), 'utf8');
      const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (node: ts.Node) => {
        if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(file) === 'SettingCard') {
          const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
          const idValue = attributes.find((attribute) => attribute.name.getText(file) === 'settingId')?.initializer;
          const id = idValue && ts.isStringLiteral(idValue) ? idValue.text : undefined;
          expect(id, `${name}: every card needs a catalog id`).toBeDefined();
          const card = SETTINGS_CARDS.find((entry) => entry.id === id);
          expect(card, `${name}: ${id}`).toBeDefined();
          const title = attributes.find((attribute) => attribute.name.getText(file) === 'title')?.initializer;
          const titles: string[] = [];
          if (title && ts.isStringLiteral(title)) titles.push(title.text);
          if (title && ts.isJsxExpression(title) && title.expression && ts.isConditionalExpression(title.expression)) {
            for (const branch of [title.expression.whenTrue, title.expression.whenFalse]) {
              if (ts.isStringLiteral(branch)) titles.push(branch.text);
            }
          }
          expect(titles.length, `${name}: card title must be checked`).toBeGreaterThan(0);
          for (const value of titles) expect(card?.titles).toContain(value);
          seen.push(id!);
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
    expect(seen.sort()).toEqual(SETTINGS_CARDS.map((card) => card.id).sort());
  });
});
