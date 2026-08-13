import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  fallback?: ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary implementing the component-level isolation requirement
 * (spec §11.2). A crashed component subtree is replaced with a fallback
 * while the rest of the application keeps running.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[error-boundary]', error, info);
    this.props.onError?.(error, info);
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="error-fallback">
          <div className="error-fallback-title">⚠ {this.state.error?.message ?? 'Something went wrong'}</div>
          <button type="button" className="btn" onClick={this.reset}>
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}