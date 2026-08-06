'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportClientError } from '@/services/errorReporting';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Rendered instead of the crashed subtree. Receives the error and a reset callback. */
  fallback: (error: Error, reset: () => void) => ReactNode;
  /** Identifies which widget crashed in error reports (e.g. "ai-assistant-panel"). */
  boundaryName: string;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Isolates a risky, self-contained widget (chart, PDF viewer, AI assistant,
 * live-monitoring panel, a table, a form) so a render exception inside it
 * can't take down the rest of the page. React only supports error boundaries
 * as class components (`componentDidCatch`/`getDerivedStateFromError` have
 * no hook equivalent) — this is the one place `class` is the correct tool.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    reportClientError(error, {
      boundary: this.props.boundaryName,
      componentStack: errorInfo.componentStack ?? undefined,
    });
  }

  reset = (): void => {
    this.props.onReset?.();
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      return this.props.fallback(this.state.error, this.reset);
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
