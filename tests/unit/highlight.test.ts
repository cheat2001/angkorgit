import { describe, expect, it } from 'vitest';
import { highlightLineState, languageOf, supportsBlockComments } from '@/shared/highlight';

const text = (html: string) => html.replace(/<[^>]+>/g, '');
const wholeLineIsComment = (html: string) =>
  /^<span class="hljs-comment">/.test(html) && !/hljs-(keyword|title|string|built_in)/.test(html);

describe('highlightLineState', () => {
  it('carries a JSDoc block across lines and closes it on */', () => {
    const open = highlightLineState('/**', 'typescript');
    expect(open.endsInComment).toBe(true);

    const middle = highlightLineState(
      ' * Free Bet funding dimension. Stored and transmitted PascalCase.',
      'typescript',
      true,
    );
    expect(middle.endsInComment).toBe(true);
    expect(wholeLineIsComment(middle.html)).toBe(true);
    expect(text(middle.html)).toBe(' * Free Bet funding dimension. Stored and transmitted PascalCase.');

    const close = highlightLineState(' */', 'typescript', true);
    expect(close.endsInComment).toBe(false);
    expect(wholeLineIsComment(close.html)).toBe(true);

    const code = highlightLineState('export enum EnumSponsorType {', 'typescript', false);
    expect(code.endsInComment).toBe(false);
    expect(code.html).toContain('hljs-keyword');
  });

  it('does not carry a /* that is glued to a word, such as JSX text like feature/*', () => {
    const jsx = highlightLineState(
      `<span className="font-mono">feature/*</span> → <span className="font-mono">[{'{suffix}'}]</span>.`,
      'typescript',
    );
    expect(jsx.endsInComment).toBe(false);
    expect(highlightLineState('const glob = pattern + "/" + name/*', 'typescript').endsInComment).toBe(false);
    expect(highlightLineState('const x = 1; /* trailing note', 'typescript').endsInComment).toBe(true);
    expect(highlightLineState('run(/* inline start', 'typescript').endsInComment).toBe(true);
    expect(highlightLineState('/* at line start', 'typescript').endsInComment).toBe(true);
  });

  it('does not treat line comments or glob strings as open block comments', () => {
    expect(highlightLineState('// just a note', 'typescript').endsInComment).toBe(false);
    expect(highlightLineState("const files = glob('src/**/*.ts');", 'typescript').endsInComment).toBe(false);
    expect(highlightLineState('const a = 1; /* trailing */', 'typescript').endsInComment).toBe(false);
  });

  it('resumes code after the comment closes mid-line', () => {
    const line = highlightLineState(' end of note */ const after = 1;', 'typescript', true);
    expect(line.endsInComment).toBe(false);
    expect(line.html.startsWith('<span class="hljs-comment">')).toBe(true);
    expect(line.html).toContain('hljs-keyword');
    expect(text(line.html)).toBe(' end of note */ const after = 1;');
  });

  it('handles html comments with the xml opener', () => {
    expect(highlightLineState('<!-- header', 'xml').endsInComment).toBe(true);
    const inner = highlightLineState('  still a comment <b>not a tag</b>', 'xml', true);
    expect(inner.endsInComment).toBe(true);
    expect(inner.html).not.toContain('hljs-tag');
    expect(text(inner.html)).toBe('  still a comment &lt;b&gt;not a tag&lt;/b&gt;');
    expect(highlightLineState('done -->', 'xml', true).endsInComment).toBe(false);
  });

  it('highlights a less variable and selector', () => {
    expect(languageOf('styles/theme.less')).toBe('less');
    expect(supportsBlockComments('less')).toBe(true);
    const variable = highlightLineState('@color: #fff;', 'less');
    expect(variable.html).toContain('hljs-variable');
    expect(variable.html).toContain('hljs-number');
    const rule = highlightLineState('.btn { color: red; }', 'less');
    expect(rule.html).toContain('hljs-selector-class');
    expect(rule.html).toContain('hljs-attribute');
  });

  it('maps aliases and basenames for common config and style files', () => {
    expect(languageOf('src/util.cts')).toBe('typescript');
    expect(languageOf('readme.markdown')).toBe('markdown');
    expect(languageOf('types/foo.pyi')).toBe('python');
    expect(languageOf('App.kts')).toBe('kotlin');
    expect(languageOf('board.ino')).toBe('cpp');
    expect(languageOf('index.htm')).toBe('xml');
    expect(languageOf('styles/app.scss')).toBe('scss');
    expect(languageOf('config/app.ini')).toBe('ini');
    expect(languageOf('messages.properties')).toBe('properties');
    expect(languageOf('repo/.gitignore')).toBe('properties');
    expect(languageOf('.editorconfig')).toBe('properties');
    expect(languageOf('Dockerfile')).toBe('dockerfile');
    expect(languageOf('path/Makefile')).toBe('makefile');
    expect(languageOf('CMakeLists.txt')).toBe('cmake');
    expect(languageOf('tool.cmake')).toBe('cmake');
  });

  it('highlights scss variables and dockerfile keywords', () => {
    expect(supportsBlockComments('scss')).toBe(true);
    const scssLine = highlightLineState('$color: #fff;', 'scss');
    expect(scssLine.html).toContain('hljs-variable');
    const docker = highlightLineState('FROM node:20-alpine', 'dockerfile');
    expect(docker.html).toContain('hljs-keyword');
    const ignore = highlightLineState('node_modules/', 'properties');
    expect(text(ignore.html)).toBe('node_modules/');
  });

  it('ignores the continuation flag for languages without block comments', () => {
    expect(supportsBlockComments('python')).toBe(false);
    const line = highlightLineState('x = 1', 'python', true);
    expect(line.html).toContain('x');
    expect(line.endsInComment).toBe(false);
  });
});
