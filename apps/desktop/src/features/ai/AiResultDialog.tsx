import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { Copy } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@angkorgit/design-system';
import { AiText } from './AiText';

export function AiResultDialog({
  open,
  onOpenChange,
  title,
  icon,
  text,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  icon?: ReactNode;
  text: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[85vh] w-[min(56rem,90vw)] max-w-none flex-col"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {icon} {title}
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <AiText text={text} className="text-sm leading-relaxed text-foreground/90" />
        </div>
        <div className="mt-4 flex shrink-0 items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              navigator.clipboard
                .writeText(text)
                .then(() => toast.success('Copied'))
                .catch(() => toast.error('Could not copy'));
            }}
          >
            <Copy className="size-3" /> Copy
          </Button>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
