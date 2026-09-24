import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import rust from 'highlight.js/lib/languages/rust';
import python from 'highlight.js/lib/languages/python';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import csharp from 'highlight.js/lib/languages/csharp';
import cpp from 'highlight.js/lib/languages/cpp';
import css from 'highlight.js/lib/languages/css';
import less from 'highlight.js/lib/languages/less';
import scss from 'highlight.js/lib/languages/scss';
import xml from 'highlight.js/lib/languages/xml';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import bash from 'highlight.js/lib/languages/bash';
import markdown from 'highlight.js/lib/languages/markdown';
import sql from 'highlight.js/lib/languages/sql';
import ruby from 'highlight.js/lib/languages/ruby';
import php from 'highlight.js/lib/languages/php';
import kotlin from 'highlight.js/lib/languages/kotlin';
import swift from 'highlight.js/lib/languages/swift';
import ini from 'highlight.js/lib/languages/ini';
import properties from 'highlight.js/lib/languages/properties';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import makefile from 'highlight.js/lib/languages/makefile';
import cmake from 'highlight.js/lib/languages/cmake';

hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('python', python);
hljs.registerLanguage('go', go);
hljs.registerLanguage('java', java);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('css', css);
hljs.registerLanguage('less', less);
hljs.registerLanguage('scss', scss);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('json', json);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('ruby', ruby);
hljs.registerLanguage('php', php);
hljs.registerLanguage('kotlin', kotlin);
hljs.registerLanguage('swift', swift);
hljs.registerLanguage('ini', ini);
hljs.registerLanguage('properties', properties);
hljs.registerLanguage('dockerfile', dockerfile);
hljs.registerLanguage('makefile', makefile);
hljs.registerLanguage('cmake', cmake);

const BASENAME_TO_LANG: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  gnumakefile: 'makefile',
  'cmakelists.txt': 'cmake',
  '.editorconfig': 'ini',
};

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  rs: 'rust',
  py: 'python',
  pyi: 'python',
  go: 'go',
  java: 'java',
  cs: 'csharp',
  c: 'cpp',
  h: 'cpp',
  cc: 'cpp',
  cpp: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  hxx: 'cpp',
  cxx: 'cpp',
  ino: 'cpp',
  css: 'css',
  less: 'less',
  scss: 'scss',
  html: 'xml',
  htm: 'xml',
  svg: 'xml',
  xml: 'xml',
  vue: 'xml',
  json: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'bash',
  zsh: 'bash',
  bash: 'bash',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  sql: 'sql',
  rb: 'ruby',
  php: 'php',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  ini: 'ini',
  properties: 'properties',
  cmake: 'cmake',
};

function fileName(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return (slash >= 0 ? path.slice(slash + 1) : path).toLowerCase();
}

export function languageOf(path: string): string | null {
  const name = fileName(path);
  const byName = BASENAME_TO_LANG[name];
  if (byName) return byName;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  return EXT_TO_LANG[name.slice(dot + 1)] ?? null;
}

const MAX_HIGHLIGHT_LENGTH = 5000;
const CACHE_MAX = 4000;

const BLOCK_COMMENT_OPENERS: Record<string, string> = {
  typescript: '/*',
  javascript: '/*',
  rust: '/*',
  go: '/*',
  java: '/*',
  csharp: '/*',
  cpp: '/*',
  css: '/*',
  less: '/*',
  scss: '/*',
  kotlin: '/*',
  swift: '/*',
  php: '/*',
  sql: '/*',
  xml: '<!--',
};

export function supportsBlockComments(language: string | null): boolean {
  return language !== null && language in BLOCK_COMMENT_OPENERS;
}

export interface HighlightedLine {
  html: string;
  endsInComment: boolean;
}

interface ModeChain {
  scope?: string;
  className?: string;
  endRe?: RegExp;
  parent?: ModeChain;
}

const GLUED_TO_WORD = /[\w$/>]$/;

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&');
}

function openerGluedToCode(html: string): boolean {
  const index = html.lastIndexOf('<span class="hljs-comment">');
  if (index < 0) return false;
  const before = decodeEntities(html.slice(0, index).replace(/<[^>]+>/g, ''));
  return GLUED_TO_WORD.test(before);
}

function endsInBlockComment(top: unknown): boolean {
  let mode = top as ModeChain | undefined;
  while (mode) {
    if (mode.scope === 'comment' || mode.className === 'comment') {
      return mode.endRe instanceof RegExp && !mode.endRe.test('');
    }
    mode = mode.parent;
  }
  return false;
}

const highlightCache = new Map<string, HighlightedLine>();

export function highlightLineState(
  code: string,
  language: string | null,
  startsInComment = false,
): HighlightedLine {
  if (!language || code.length > MAX_HIGHLIGHT_LENGTH) {
    return { html: escapeHtml(code), endsInComment: false };
  }
  const opener = BLOCK_COMMENT_OPENERS[language];
  const continued = startsInComment && opener !== undefined;
  const key = `${language} ${continued ? 1 : 0} ${code}`;
  const cached = highlightCache.get(key);
  if (cached !== undefined) {
    highlightCache.delete(key);
    highlightCache.set(key, cached);
    return cached;
  }
  let result: HighlightedLine;
  try {
    const out = hljs.highlight(continued ? opener + code : code, { language, ignoreIllegals: true });
    let html = out.value;
    if (continued) {
      const escapedOpener = opener.replace(/</g, '&lt;');
      const index = html.indexOf(escapedOpener);
      if (index >= 0) html = html.slice(0, index) + html.slice(index + escapedOpener.length);
    }
    result = {
      html,
      endsInComment:
        opener !== undefined && endsInBlockComment(out._top) && !openerGluedToCode(out.value),
    };
  } catch {
    result = { html: escapeHtml(code), endsInComment: false };
  }
  if (highlightCache.size >= CACHE_MAX) {
    highlightCache.delete(highlightCache.keys().next().value as string);
  }
  highlightCache.set(key, result);
  return result;
}

export function highlightLine(code: string, language: string | null): string {
  return highlightLineState(code, language).html;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
