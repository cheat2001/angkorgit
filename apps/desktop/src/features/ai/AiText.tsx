import { Fragment } from 'react';
import { parseAiTextSegments } from '@angkorgit/core';
import { cn } from '@angkorgit/design-system';

export function AiText({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] font-sans', className)}>
      {parseAiTextSegments(text).map((segment, index) => {
        if (segment.kind === 'bold') {
          return (
            <strong key={index} className="font-semibold text-foreground">
              {segment.text}
            </strong>
          );
        }
        if (segment.kind === 'code') {
          return (
            <code key={index} className="rounded bg-surface-raised px-1 py-px font-mono text-[0.9em]">
              {segment.text}
            </code>
          );
        }
        return <Fragment key={index}>{segment.text}</Fragment>;
      })}
    </div>
  );
}
