import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export function PaneEmpty({
  icon,
  title,
  description,
  children,
  className,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'relative flex h-full min-h-64 items-center justify-center overflow-hidden px-6',
        className,
      )}
    >
      <div className="relative flex max-w-[16rem] flex-col items-center gap-3 text-center">
        <span aria-hidden className="rounded-lg bg-primary/15 p-2.5 text-primary [&_svg]:size-5">
          {icon}
        </span>
        <div>
          <p className="text-sm font-medium text-foreground">{title}</p>
          {description ? (
            <p className="mt-1 text-xs leading-relaxed text-muted">{description}</p>
          ) : null}
        </div>
        {children}
      </div>
    </div>
  );
}
