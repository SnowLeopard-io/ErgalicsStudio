// ==========================================================================
// Ergalics Studio — embedded terminal drawer panel (desktop edition, D2.5)
//
// Multi-session terminal built on @xterm/xterm and the desktop PTY bridge
// (`window.ergalicsDesktop.pty`, typed as DesktopPtyApi). One PTY per tab;
// each tab owns its xterm instance, its ResizeObserver-driven fit and its
// subscriptions. The workbench mounts this panel lazily and only when the
// drawer is open, so the web edition never fetches or executes xterm code.
//
// PTY ownership lives in the per-tab view component: the PTY is started in
// the mount effect and killed in the cleanup. That keeps React StrictMode's
// dev double-mount safe (the abandoned first session is killed on cleanup)
// and makes both "close tab" and "close drawer" a plain unmount.
//
// UI strings here are intentionally plain English: the i18n dictionaries
// are outside the allowed edit surface for the terminal feature.
// ==========================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import '@xterm/xterm/css/xterm.css';
import { Terminal } from '@xterm/xterm';
import type { ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { CloseIcon, PlusIcon } from '@/components/icons';
import { IS_DESKTOP, desktopBridge } from '@/core/platform';

// Dark palette mirrors the global CSS variables (styles/global.css). The
// xterm canvas cannot read CSS variables, so the values are pinned here —
// keep them in sync with the light/dark tokens if the theme changes.
const TERM_THEME: ITheme = {
  background: '#0d1117', // --color-bg-primary
  foreground: '#e6edf3', // --color-text-primary
  cursor: '#2dd4bf', // --color-accent
  cursorAccent: '#0d1117',
  selectionBackground: '#28364a', // --color-bg-active
  black: '#0d1117',
  red: '#f87171', // --color-error
  green: '#34d399', // --color-success
  yellow: '#fbbf24', // --color-warning
  blue: '#60a5fa',
  magenta: '#f472b6', // --cat-fun
  cyan: '#22d3ee', // --cat-scientific
  white: '#e6edf3',
  brightBlack: '#778ba3', // --color-text-tertiary
  brightRed: '#fca5a5',
  brightGreen: '#6ee7b7',
  brightYellow: '#fde68a',
  brightBlue: '#93c5fd',
  brightMagenta: '#f9a8d4',
  brightCyan: '#67e8f9',
  brightWhite: '#ffffff',
};

// Windows Terminal's own stack: Cascadia ships with Windows 10+, then the
// classic Consolas fallback. xterm needs a concrete family list.
const TERM_FONT = '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace';

interface SessionMeta {
  /** Stable local key — the PTY id only exists once the shell is up. */
  key: string;
  ptyId: string | null;
  shellName: string | null;
  /** True once the shell process ended on its own (tab stays for scrollback). */
  exited: boolean;
}

let sessionCounter = 0;

function nextSessionKey(): string {
  sessionCounter += 1;
  return `t${sessionCounter}`;
}

// ---- one tab: xterm instance + PTY lifecycle ------------------------------

interface TerminalSessionProps {
  sessionKey: string;
  active: boolean;
  /** Fired once the PTY is up (id + shell display name for the tab label). */
  onStarted: (key: string, ptyId: string, shellName: string) => void;
  /** Fired when the shell process ends on its own. */
  onExited: (key: string) => void;
}

function TerminalSession({ sessionKey, active, onStarted, onExited }: TerminalSessionProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);

  // Keyboard focus follows the visible tab.
  useEffect(() => {
    if (active) termRef.current?.focus();
  }, [active]);

  useEffect(() => {
    const host = hostRef.current;
    // Web-edition guard: the panel is not even rendered there, but keep the
    // effect inert if this module ever loads outside the desktop shell.
    if (!host || !IS_DESKTOP) return;
    const bridge = desktopBridge();

    const term = new Terminal({
      fontFamily: TERM_FONT,
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 5000,
      theme: TERM_THEME,
    });
    termRef.current = term;
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);

    let ptyId: string | null = null;
    let cancelled = false;
    let exited = false;
    let lastCols = 0;
    let lastRows = 0;
    // Keys typed while the shell is still starting are flushed once it is.
    let pendingInput = '';

    const inputDisp = term.onData((data) => {
      if (ptyId !== null && !exited) void bridge.pty.write(ptyId, data);
      else pendingInput += data;
    });

    // Shell output → terminal. The bridge callbacks are global (id-tagged);
    // filter to this session's PTY.
    const offData = bridge.pty.onData((id, data) => {
      if (id === ptyId) term.write(data);
    });

    const offExit = bridge.pty.onExit((id, code) => {
      if (id !== ptyId || exited) return;
      exited = true;
      onExited(sessionKey);
      term.write(`\r\n\x1b[2m[process exited with code ${code}]\x1b[0m\r\n`);
    });

    const pushSize = () => {
      if (ptyId === null || exited) return;
      if (term.cols === lastCols && term.rows === lastRows) return;
      lastCols = term.cols;
      lastRows = term.rows;
      void bridge.pty.resize(ptyId, term.cols, term.rows);
    };

    const fitNow = () => {
      // Hidden tabs (display:none) have no box; fit again when shown.
      if (host.clientWidth === 0 || host.clientHeight === 0) return;
      try {
        fit.fit();
      } catch {
        // Transient layout states can make fit throw; the next
        // ResizeObserver tick retries.
      }
      pushSize();
    };

    // Resize bursts (window edge, splitter drags) fire the observer far
    // faster than the fit+resize round-trips can settle, so the observer is
    // debounced and only the trailing state is pushed to the PTY.
    let fitTimer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver(() => {
      if (fitTimer !== null) clearTimeout(fitTimer);
      fitTimer = setTimeout(fitNow, 50);
    });
    observer.observe(host);
    fitNow();

    void (async () => {
      try {
        const { id, shellName } = await bridge.pty.start({
          cols: term.cols,
          rows: term.rows,
        });
        if (cancelled) {
          // StrictMode double-mount: kill the abandoned session.
          void bridge.pty.kill(id).catch(() => {
            /* the PTY may already be gone */
          });
          return;
        }
        ptyId = id;
        lastCols = term.cols;
        lastRows = term.rows;
        onStarted(sessionKey, id, shellName);
        if (pendingInput) {
          void bridge.pty.write(id, pendingInput);
          pendingInput = '';
        }
      } catch {
        term.write('\r\n\x1b[31mFailed to start shell session.\x1b[0m\r\n');
      }
    })();

    return () => {
      cancelled = true;
      observer.disconnect();
      if (fitTimer !== null) clearTimeout(fitTimer);
      inputDisp.dispose();
      offData();
      offExit();
      term.dispose();
      termRef.current = null;
      if (ptyId !== null) {
        void bridge.pty.kill(ptyId).catch(() => {
          /* the PTY may already be gone */
        });
      }
    };
  }, [sessionKey, onStarted, onExited]);

  return (
    <div className={active ? 'terminal-tab-body is-active' : 'terminal-tab-body'}>
      <div className="terminal-session" ref={hostRef} />
    </div>
  );
}

// ---- the drawer panel: tab strip + session bodies --------------------------

export function TerminalPanel() {
  // One session up front. The initializer may be double-invoked under
  // StrictMode; the module-level counter keeps keys unique either way.
  const [sessions, setSessions] = useState<SessionMeta[]>(() =>
    IS_DESKTOP
      ? [{ key: nextSessionKey(), ptyId: null, shellName: null, exited: false }]
      : [],
  );
  const [activeKey, setActiveKey] = useState<string | null>(null);

  // Both handlers must stay reference-stable: they are dependencies of the
  // session view's mount effect (re-runs would kill and restart the shell).
  const handleStarted = useCallback((key: string, ptyId: string, shellName: string) => {
    setSessions((prev) => prev.map((s) => (s.key === key ? { ...s, ptyId, shellName } : s)));
  }, []);

  const handleExited = useCallback((key: string) => {
    setSessions((prev) => prev.map((s) => (s.key === key ? { ...s, exited: true } : s)));
  }, []);

  // Activate the initializer-created first session once it exists.
  useEffect(() => {
    setActiveKey((cur) => {
      if (cur !== null) return cur;
      const last = sessions[sessions.length - 1];
      return last ? last.key : cur;
    });
  }, [sessions]);

  const addSession = useCallback(() => {
    if (!IS_DESKTOP) return;
    const key = nextSessionKey();
    setSessions((prev) => [...prev, { key, ptyId: null, shellName: null, exited: false }]);
    setActiveKey(key);
  }, []);

  const closeSession = (key: string) => {
    const idx = sessions.findIndex((s) => s.key === key);
    if (idx === -1) return;
    const next = sessions.filter((s) => s.key !== key);
    setSessions(next);
    if (activeKey === key) {
      // Hand focus to a neighbour (the removed session's PTY is killed by
      // its unmounting view).
      const fallback = next[Math.min(idx, next.length - 1)] ?? null;
      setActiveKey(fallback ? fallback.key : null);
    }
  };

  // Web edition: nothing to render (the activity-rail toggle is hidden there
  // too). Kept after the hooks so the hook order stays consistent.
  if (!IS_DESKTOP) return null;

  return (
    <section className="terminal-panel" aria-label="Terminal">
      <div className="terminal-tabbar">
        {sessions.map((s) => {
          const active = s.key === activeKey;
          return (
            <div
              key={s.key}
              className={`terminal-tab${active ? ' is-active' : ''}${s.exited ? ' is-exited' : ''}`}
            >
              <button
                type="button"
                className="terminal-tab-btn"
                title={s.shellName ?? 'Terminal'}
                aria-label={s.shellName ? `Switch to ${s.shellName}` : 'Switch terminal tab'}
                aria-pressed={active}
                onClick={() => setActiveKey(s.key)}
              >
                <span className="terminal-tab-label">{s.shellName ?? 'starting…'}</span>
              </button>
              <button
                type="button"
                className="terminal-tab-close"
                title="Close terminal session"
                aria-label={`Close ${s.shellName ?? 'terminal'} session`}
                onClick={() => closeSession(s.key)}
              >
                <CloseIcon size={12} />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="terminal-tab-add"
          title="New terminal session"
          aria-label="New terminal session"
          onClick={addSession}
        >
          <PlusIcon size={14} />
        </button>
      </div>

      {sessions.length === 0 ? (
        <div className="terminal-empty">No terminal sessions — open one with the + button above.</div>
      ) : (
        sessions.map((s) => (
          <TerminalSession
            key={s.key}
            sessionKey={s.key}
            active={s.key === activeKey}
            onStarted={handleStarted}
            onExited={handleExited}
          />
        ))
      )}
    </section>
  );
}
