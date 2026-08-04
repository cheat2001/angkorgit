import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Pencil, Save, X } from 'lucide-react';
import { Badge, Button, Hint, Kbd, Spinner } from '@angkorgit/design-system';
import { ipc } from '@/core/ipc';
import { useRepo } from '@/features/repository/store';
import { useUi } from '@/features/ui/store';
import { confirmDialog } from '@/components/confirm';
import { modKey } from '@/shared/utils';

export function EditorPanel({ file }: { file: string }) {
  const repo = useRepo((s) => s.repo);
  const refreshStatus = useRepo((s) => s.refreshStatus);
  const closeEditor = useUi((s) => s.closeEditor);
  const [content, setContent] = useState<string | null>(null);
  const [savedContent, setSavedContent] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const path = repo?.path ?? '';
  const dirty = content !== null && content !== savedContent;

  useEffect(() => {
    let cancelled = false;
    void ipc
      .readFile(path, file)
      .then((text) => {
        if (!cancelled) {
          setContent(text);
          setSavedContent(text);
        }
      })
      .catch((error) => {
        toast.error(`Could not open ${file}: ${(error as { message?: string }).message ?? error}`);
        closeEditor();
      });
    return () => {
      cancelled = true;
    };
  }, [path, file, closeEditor]);

  const save = async () => {
    if (content === null || saving) return;
    setSaving(true);
    try {
      await ipc.writeFile(path, file, content);
      setSavedContent(content);
      toast.success(`${file} saved`);
      await refreshStatus();
    } catch (error) {
      toast.error(`Save failed: ${(error as { message?: string }).message ?? error}`);
    } finally {
      setSaving(false);
    }
  };

  const requestClose = () => {
    if (!dirty) {
      closeEditor();
      return;
    }
    void confirmDialog({
      title: 'Discard unsaved changes?',
      description: `"${file}" has unsaved edits. Close without saving?`,
      confirmLabel: 'Close without saving',
      destructive: true,
    }).then((ok) => {
      if (ok) closeEditor();
    });
  };

  return (
    <motion.section
      className="flex h-full flex-col bg-background"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      aria-label={`Editing ${file}`}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-subtle bg-surface px-3">
        <Hint
          label={
            <span className="flex items-center gap-1">
              Close <Kbd>Esc</Kbd>
            </span>
          }
        >
          <Button variant="ghost" size="icon-sm" aria-label="Close editor" onClick={requestClose}>
            <X className="size-4" />
          </Button>
        </Hint>
        <Pencil className="size-3.5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{file}</span>
        {dirty && <Badge tone="primary">unsaved</Badge>}
        <Hint
          label={
            <span className="flex items-center gap-1">
              Save <Kbd>{modKey()}</Kbd>
              <Kbd>S</Kbd>
            </span>
          }
        >
          <Button size="sm" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? <Spinner className="text-primary-foreground" /> : <Save />}
            Save
          </Button>
        </Hint>
      </div>

      {content === null ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="size-5" />
        </div>
      ) : (
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          autoFocus
          aria-label={`Contents of ${file}`}
          className="min-h-0 flex-1 resize-none bg-transparent px-4 py-3 font-mono text-xs leading-5 text-foreground focus:outline-none"
          style={{ tabSize: 4 }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
              e.preventDefault();
              void save();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              requestClose();
            } else if (e.key === 'Tab') {
              e.preventDefault();
              const el = e.currentTarget;
              const { selectionStart, selectionEnd, value } = el;
              const next = `${value.slice(0, selectionStart)}\t${value.slice(selectionEnd)}`;
              setContent(next);
              requestAnimationFrame(() => {
                el.selectionStart = el.selectionEnd = selectionStart + 1;
              });
            }
          }}
        />
      )}
    </motion.section>
  );
}
