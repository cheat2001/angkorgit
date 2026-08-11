import { useId } from 'react';
import { cn } from '../lib/cn';

export function TemplePattern({ className }: { className?: string }) {
  const patternId = `temple-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`;
  return (
    <svg
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 h-full w-full text-foreground',
        className,
      )}
      style={{ opacity: 'var(--ornament, 0)' }}
    >
      <defs>
        <pattern id={patternId} patternUnits="userSpaceOnUse" width="64" height="88">
          <rect x="30" y="12" width="4" height="62" rx="2" fill="currentColor" />
          <rect x="25" y="8" width="14" height="3.5" rx="1.75" fill="currentColor" />
          <rect x="25" y="74.5" width="14" height="3.5" rx="1.75" fill="currentColor" />
          <ellipse cx="32" cy="20" rx="5.5" ry="2.2" fill="currentColor" />
          <ellipse cx="32" cy="31.5" rx="4.5" ry="2" fill="currentColor" />
          <ellipse cx="32" cy="43" rx="5.5" ry="2.2" fill="currentColor" />
          <ellipse cx="32" cy="54.5" rx="4.5" ry="2" fill="currentColor" />
          <ellipse cx="32" cy="66" rx="5.5" ry="2.2" fill="currentColor" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} />
    </svg>
  );
}
