export interface AiTextSegment {
  kind: 'bold' | 'code' | 'text';
  text: string;
}

const TOKEN_SPLIT = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g;
const BOLD_TOKEN = /^\*\*[^*\n]+\*\*$/;
const CODE_TOKEN = /^`[^`\n]+`$/;

export function parseAiTextSegments(text: string): AiTextSegment[] {
  return text
    .split(TOKEN_SPLIT)
    .filter((part) => part !== '')
    .map((part) => {
      if (BOLD_TOKEN.test(part)) return { kind: 'bold' as const, text: part.slice(2, -2) };
      if (CODE_TOKEN.test(part)) return { kind: 'code' as const, text: part.slice(1, -1) };
      return { kind: 'text' as const, text: part };
    });
}
