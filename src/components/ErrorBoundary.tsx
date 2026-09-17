import { Component, Fragment } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { t } from '@/i18n';
import { reportError, normalizeError } from '@/core/errors';

interface Props {
  fallback?: ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  details: string;
  showDetails: boolean;
  copied: boolean;
  /**
   * Bumped by `reset()` and used as the children's `key`, so a retry remounts
   * the crashed subtree from scratch. Without it, `setState({hasError:false})`
   * re-rendered the *same* broken components, which threw again immediately —
   * a retry loop that could never recover.
   */
  resetKey: number;
}

/**
 * Error boundary implementing the component-level isolation requirement
 * (spec §11.2). A crashed component subtree is replaced with a fallback
 * while the rest of the application keeps running. The error is reported to
 * the central registry and the fallback offers a copyable diagnostic
 * envelope (code + message + stack) — essential when a researcher needs to
 * attach failure context to a bug report.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    error: null,
    details: '',
    showDetails: false,
    copied: false,
    resetKey: 0,
  };

  static getDerivedStateFromError(error: Error): Partial<State> {
    const appError = normalizeError(error);
    return {
      hasError: true,
      error,
      details: JSON.stringify({ ...appError.toJSON(), component: true }, null, 2),
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error, { context: { react: { componentStack: info.componentStack } } });
    this.props.onError?.(error, info);
  }

  reset = () => {
    this.setState((state) => ({
      hasError: false,
      error: null,
      details: '',
      showDetails: false,
      copied: false,
      resetKey: state.resetKey + 1,
    }));
  };

  private toggleDetails = () => {
    this.setState((state) => ({ showDetails: !state.showDetails }));
  };

  private copyDetails = async () => {
    try {
      await navigator.clipboard.writeText(this.state.details);
      this.setState({ copied: true });
    } catch {
      // Clipboard can be unavailable (insecure context / permissions); the
      // details remain visible and selectable in the <pre> fallback.
      this.setState({ copied: false });
    }
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      const appError = this.state.error ? normalizeError(this.state.error) : null;
      return (
        <div className="error-fallback" role="alert">
          <div className="error-fallback-title">
            ⚠ {this.state.error?.message ?? t('error.unexpected')}
          </div>
          {appError && <div className="error-fallback-code">{appError.code}</div>}
          <div className="error-fallback-actions">
            <button type="button" className="btn" onClick={this.reset}>
              {t('common.retry')}
            </button>
            <button type="button" className="btn btn-ghost" onClick={this.toggleDetails}>
              {t('error.details')}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => void this.copyDetails()}>
              {this.state.copied ? t('error.copied') : t('error.copy_details')}
            </button>
          </div>
          {this.state.showDetails && (
            <pre className="error-fallback-detail">{this.state.details}</pre>
          )}
        </div>
      );
    }
    // The key must live on a single element *inside* the boundary: remounting
    // the boundary itself would be done by the parent. A keyed Fragment adds no
    // DOM node, so CSS child combinators outside are unaffected.
    return <Fragment key={this.state.resetKey}>{this.props.children}</Fragment>;
  }
}
