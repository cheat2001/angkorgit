import { Component, type ReactNode } from 'react';
import { AlertTriangle, ClipboardCopy, RotateCcw } from 'lucide-react';
import { Button, Logo } from '@angkorgit/design-system';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('AngKorGit crashed:', error, info.componentStack);
  }

  private copyDetails = () => {
    const { error } = this.state;
    void navigator.clipboard.writeText(
      `AngKorGit error report\n\n${error?.name}: ${error?.message}\n\n${error?.stack ?? ''}`,
    );
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-background p-8 text-center">
        <Logo size={48} className="text-foreground" />
        <div className="flex items-center gap-2 text-danger">
          <AlertTriangle className="size-5" />
          <h1 className="text-lg font-semibold text-foreground">Something went wrong</h1>
        </div>
        <p className="max-w-md text-sm text-muted">
          AngKorGit hit an unexpected error. Your repositories are safe — this only affects the
          interface. Restarting usually fixes it; if it keeps happening, please report the details
          below.
        </p>
        <pre className="max-h-40 max-w-lg overflow-auto rounded-lg border border-border bg-surface p-3 text-left font-mono text-xs text-danger">
          {error.name}: {error.message}
        </pre>
        <div className="flex gap-2">
          <Button onClick={() => window.location.reload()}>
            <RotateCcw /> Restart interface
          </Button>
          <Button variant="secondary" onClick={this.copyDetails}>
            <ClipboardCopy /> Copy error details
          </Button>
        </div>
      </div>
    );
  }
}
