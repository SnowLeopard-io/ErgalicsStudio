import { Component, Fragment } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { t } from '@/i18n';
import { reportError, normalizeError } from '@/core/errors';
import { isChunkLoadError } from '@/core/lazyRetry';

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
      // A lazy-chunk import that survived every silent retry gets its own
      // recovery card: the module may come back after a dev-server restart or
      // a redeploy, so offer a non-destructive retry (remount) first and make
      // the page reload an explicit, warned-about choice — reloading would
      // interrupt running simulations and discard unsaved buffers.
      if (isChunkLoadError(this.state.error)) {
        return (
          <div className="error-fallback" role="alert">
            <div className="error-fallback-title">⦿ {t('error.chunk_title')}</div>
            <div className="error-fallback-note">{t('error.chunk_body')}</div>
            <div className="error-fallback-note error-fallback-warn">{t('error.chunk_warn')}</div>
            <div className="error-fallback-actions">
              <button type="button" className="btn" onClick={this.reset}>
                {t('error.chunk_retry')}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => window.location.reload()}
              >
                {t('error.chunk_reload')}
              </button>
              <button type="button" className="btn btn-ghost" onClick={this.toggleDetails}>
                {t('error.details')}
              </button>
            </div>
            {this.state.showDetails && (
              <pre className="error-fallback-detail">{this.state.details}</pre>
            )}
          </div>
        );
      }
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
