// ==========================================================================
// Ergalics Studio — workbench terminal (floating, multi-session window)
//
// A shell-flavoured REPL over the session-wide Python interpreter
// (core/pyodide/code-runtime), presented as a free-floating card that can be
// resized (top/left grips) and dragged anywhere on screen (clamped to the
// viewport). Sessions live in stores/terminalStore: a side strip inside the
// card switches between them, each with its own transcript, cwd and input
// history. The 'run' session mirrors the global run console, so output from
// the editors' 运行 button always lands in a session the user can see.
//
// Geometry (open state, size, position) persists to localStorage; transcripts
// are session-level and intentionally do not survive a reload.
//
// Commands: raw Python lines go to `runtime.repl()` (expressions echo their
// repr; print() streams via the global stdout subscription). Shell-style
// magics (pwd / cd / ls / dir / cat / type / clear / cls — every platform's
// habits map to one action, see core/pyodide/repl-commands) translate into
// small Python programs on the same channel, so `cd` moves the session's
// real cwd and `ls` lists the mounted /workspace tree.
// ==========================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { useAppStore } from '@/stores/appStore';
import { useEditorStore } from '@/stores/editorStore';
import {
  RUN_SESSION_ID,
  useTerminalStore,
} from '@/stores/terminalStore';
import { getPythonRuntime, warmPythonRuntime } from '@/core/pyodide/code-runtime';
import {
  buildMagicPython,
  isClearCommand,
  parseReplCommand,
} from '@/core/pyodide/repl-commands';
import { CloseIcon, PlusIcon, TerminalIcon } from '@/components/icons';

/** How many submitted lines stay in a session's input history (↑/↓). */
const HISTORY_LIMIT = 100;

/** Floating-window bounds for the resize grips (min px / max × viewport). */
const SIZE_MIN = { w: 360, h: 200 };
const SIZE_MAX = { w: 0.9, h: 0.85 };
const SIZE_DEFAULT = { w: 560, h: 340 };
/** Margin kept from the screen edges while dragging (never dragged off-screen). */
const EDGE_MARGIN = 8;

const PREFS_KEY = 'ergalics:terminal-prefs';

interface TerminalPrefs {
  open: boolean;
  w: number;
  h: number;
  /** Absolute position; null = default (anchored above the status bar, right). */
  pos: { left: number; top: number } | null;
}

function loadPrefs(): TerminalPrefs {
  const fallback: TerminalPrefs = { open: false, w: SIZE_DEFAULT.w, h: SIZE_DEFAULT.h, pos: null };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<TerminalPrefs>;
    const vpMin = (v: number, min: number) => Math.max(Math.min(v, window.innerWidth - 2 * EDGE_MARGIN), min);
    const vpMinH = (v: number, min: number) => Math.max(Math.min(v, window.innerHeight - 2 * EDGE_MARGIN), min);
    return {
      open: p.open === true,
      w: p.w ? vpMin(p.w, SIZE_MIN.w) : fallback.w,
      h: p.h ? vpMinH(p.h, SIZE_MIN.h) : fallback.h,
      pos: p.pos ? { left: p.pos.left, top: p.pos.top } : null,
    };
  } catch {
    return fallback;
  }
}

/** Which resize grip was grabbed (bottom-right stays anchored). */
type ResizeDir = 'n' | 'w' | 'nw';

export function TerminalPanel() {
  const t = useT();
  const prefs = useRef(loadPrefs());

  const open = useAppStore((s) => s.terminalOpen);
  const toggle = useAppStore((s) => s.toggleTerminal);

  const sessions = useTerminalStore((s) => s.sessions);
  const activeId = useTerminalStore((s) => s.activeId);
  const transcripts = useTerminalStore((s) => s.transcripts);
  const createSession = useTerminalStore((s) => s.createSession);
  const closeSession = useTerminalStore((s) => s.closeSession);
  const setActive = useTerminalStore((s) => s.setActive);
  const setCwdStore = useTerminalStore((s) => s.setCwd);

  const activeSession = sessions.find((x) => x.id === activeId) ?? sessions[0]!;
  // The run session's transcript IS the global editor console (all run output
  // and editor error appends land there); extra sessions own their entries.
  const runConsole = useEditorStore((s) => s.console);
  const clearRunConsole = useEditorStore((s) => s.clearConsole);
  const entries = useMemo(
    () =>
      activeSession.id === RUN_SESSION_ID
        ? runConsole
        : (transcripts[activeSession.id] ?? []),
    [activeSession.id, runConsole, transcripts],
  );
  const clearActive = useMemo(
    () =>
      activeSession.id === RUN_SESSION_ID
        ? clearRunConsole
        : () => useTerminalStore.getState().clearSession(activeSession.id),
    [activeSession.id, clearRunConsole],
  );

  const cwd = activeSession.cwd;

  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  /** Per-session input history (↑/↓), keyed by session id. */
  const historyRef = useRef<Record<string, string[]>>({});
  const [history, setHistory] = useState<string[]>([]);
  /** Position in `history` while browsing: -1 = live draft. */
  const [historyIdx, setHistoryIdx] = useState(-1);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ---- window geometry (persisted) -------------------------------------
  const [size, setSize] = useState({ w: prefs.current.w, h: prefs.current.h });
  /** null = anchored above the status bar on the right (the default dock). */
  const [pos, setPos] = useState<TerminalPrefs['pos']>(prefs.current.pos);
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const resizeRef = useRef<{ dir: ResizeDir; x: number; y: number; w: number; h: number } | null>(null);

  // Restore the persisted open state once on mount (appStore defaults closed).
  useEffect(() => {
    if (prefs.current.open && !useAppStore.getState().terminalOpen) toggle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist geometry whenever any of it changes.
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ open, w: size.w, h: size.h, pos } satisfies TerminalPrefs));
    } catch {
      /* private mode — geometry simply does not persist */
    }
  }, [open, size, pos]);

  const startResize = (dir: ResizeDir) => (e: React.PointerEvent) => {
    e.preventDefault();
    resizeRef.current = { dir, x: e.clientX, y: e.clientY, w: size.w, h: size.h };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onResizeMove = (e: React.PointerEvent) => {
    const drag = resizeRef.current;
    if (!drag) return;
    const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
    const maxW = Math.min(window.innerWidth * SIZE_MAX.w, window.innerWidth - 2 * EDGE_MARGIN);
    const maxH = Math.min(window.innerHeight * SIZE_MAX.h, window.innerHeight - 2 * EDGE_MARGIN);
    let { w, h } = drag;
    // When docked (pos=null) the bottom-right stays anchored, so dragging the
    // left edge up-left GROWS the card. In free-position mode the same grips
    // behave like window edges: the opposite corner follows the pointer.
    if (drag.dir !== 'n') w = clamp(drag.w - (e.clientX - drag.x), SIZE_MIN.w, maxW);
    if (drag.dir !== 'w') h = clamp(drag.h - (e.clientY - drag.y), SIZE_MIN.h, maxH);
    const next = { w: Math.round(w), h: Math.round(h) };
    setSize(next);
    // Keep a dragged window fully on-screen while resizing.
    setPos((p) =>
      p
        ? {
            left: Math.min(Math.max(p.left, EDGE_MARGIN), window.innerWidth - next.w - EDGE_MARGIN),
            top: Math.min(Math.max(p.top, EDGE_MARGIN), window.innerHeight - next.h - EDGE_MARGIN),
          }
        : p,
    );
  };

  const endResize = () => {
    resizeRef.current = null;
  };

  // Title-bar drag: the first drag converts the docked anchor to absolute
  // coordinates, then the window follows the pointer — clamped so it can
  // never leave the viewport. The drag starts ONLY on the bare title bar:
  // pointerdown on a button (close) must not capture the pointer, or the
  // button never receives its click.
  const startDrag = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).closest('.terminal-window')!.getBoundingClientRect();
    const base = pos ?? { left: rect.left, top: rect.top };
    setPos(base);
    dragRef.current = { x: e.clientX, y: e.clientY, left: base.left, top: base.top };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onDragMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const left = Math.min(
      Math.max(drag.left + (e.clientX - drag.x), EDGE_MARGIN),
      window.innerWidth - size.w - EDGE_MARGIN,
    );
    const top = Math.min(
      Math.max(drag.top + (e.clientY - drag.y), EDGE_MARGIN),
      window.innerHeight - size.h - EDGE_MARGIN,
    );
    setPos({ left, top });
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  // Global shortcut: toggle from anywhere, even while hidden. `+` because the
  // backquote key reports different key values across keyboard layouts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.altKey && !e.metaKey && e.key === '`') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  // Opening the window from a cold session should start warming the
  // interpreter immediately (silent: no runtime-notice chrome for a preempt).
  useEffect(() => {
    if (open) {
      void warmPythonRuntime({ silent: true });
      // Focus after the open transition so the window is ready to type into.
      const timer = window.setTimeout(() => inputRef.current?.focus(), 180);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [open]);

  // Keep the latest output visible, like a real terminal.
  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [entries]);

  /** Append a line to the ACTIVE session's transcript. */
  const appendActive = useCallback(
    (stream: 'stdout' | 'stderr' | 'info', text: string) => {
      if (activeSession.id === RUN_SESSION_ID) {
        useEditorStore.getState().appendConsole({ stream, text });
      } else {
        useTerminalStore.getState().append(activeSession.id, { stream, text, timestamp: Date.now() });
      }
    },
    [activeSession.id],
  );

  const submit = useCallback(
    async (line: string) => {
      const text = line.trim();
      if (!text || busy) return;
      const sessionId = activeSession.id;

      const nextHistory = [...(historyRef.current[sessionId] ?? []).slice(-(HISTORY_LIMIT - 1)), text];
      historyRef.current[sessionId] = nextHistory;
      setHistory(nextHistory);
      setHistoryIdx(-1);
      setDraft('');
      setBusy(true);
      try {
        if (isClearCommand(text)) {
          clearActive();
          return;
        }
        // Echo the prompt line so the transcript reads like a shell session.
        appendActive('info', `${cwd}>${text}`);
        const cmd = parseReplCommand(text);
        const code = cmd ? buildMagicPython(cmd) : text;
        const result = await getPythonRuntime().repl(code);
        if (result.ok && result.text) appendActive('stdout', result.text);
        if (!result.ok) {
          appendActive('stderr', result.error ?? 'error');
        }
        // A successful `cd` moves the interpreter's cwd: re-query it (as an
        // expression, so the repr comes back in result.text) and refresh this
        // session's prompt. Magics print via stdout, so their result.text is
        // empty — this side channel is the only way to read the path back.
        if (cmd?.magic === 'cd' && result.ok) {
          const pwd = await getPythonRuntime().repl("__import__('os').getcwd()");
          if (pwd.ok && pwd.text) {
            setCwdStore(sessionId, pwd.text.trim().replace(/^'(.*)'$/, '$1'));
          }
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, activeSession.id, cwd, appendActive, clearActive, setCwdStore],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit(draft);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = historyIdx < 0 ? history.length - 1 : Math.max(0, historyIdx - 1);
      if (next >= 0 && history[next] !== undefined) {
        setHistoryIdx(next);
        setDraft(history[next]!);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIdx < 0) return;
      const next = historyIdx + 1;
      if (next >= history.length) {
        setHistoryIdx(-1);
        setDraft('');
      } else {
        setHistoryIdx(next);
        setDraft(history[next]!);
      }
    }
  };

  // Switching sessions swaps the input history too.
  useEffect(() => {
    setHistory(historyRef.current[activeId] ?? []);
    setHistoryIdx(-1);
  }, [activeId]);

  const style: React.CSSProperties = pos
    ? { left: pos.left, top: pos.top, width: size.w, height: size.h }
    : { width: size.w, height: size.h };

  return (
    <div
      className={`terminal-window${open ? '' : ' is-closed'}`}
      style={style}
      aria-hidden={!open}
      role="complementary"
      aria-label={t('terminal.title')}
    >
      {/* Window-style resize grips: top edge, left edge, top-left corner. */}
      <div className="terminal-resize is-n" onPointerDown={startResize('n')} onPointerMove={onResizeMove} onPointerUp={endResize} onPointerCancel={endResize} />
      <div className="terminal-resize is-w" onPointerDown={startResize('w')} onPointerMove={onResizeMove} onPointerUp={endResize} onPointerCancel={endResize} />
      <div className="terminal-resize is-nw" onPointerDown={startResize('nw')} onPointerMove={onResizeMove} onPointerUp={endResize} onPointerCancel={endResize} />

      {/* Session side strip: one entry per session + a new-session button. */}
      <div className="terminal-side" role="tablist" aria-label={t('terminal.title')}>
        {sessions.map((s, i) => (
          <div key={s.id} className={`terminal-side-item${s.id === activeId ? ' is-active' : ''}`}>
            <button
              type="button"
              role="tab"
              aria-selected={s.id === activeId}
              className="terminal-side-btn"
              title={i === 0 ? t('terminal.title') : `${t('terminal.title')} ${i + 1}`}
              onClick={() => setActive(s.id)}
            >
              <TerminalIcon size={14} />
            </button>
            {s.id !== RUN_SESSION_ID && (
              <button
                type="button"
                className="terminal-side-close"
                title={t('terminal.close_session')}
                aria-label={t('terminal.close_session')}
                onClick={() => closeSession(s.id)}
              >
                <CloseIcon size={9} />              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          className="terminal-side-new"
          title={t('terminal.new')}
          aria-label={t('terminal.new')}
          onClick={createSession}
        >
          <PlusIcon size={14} />
        </button>
      </div>

      <div className="terminal-main">
        {/* Title bar: icon + active session name; drag starts on the bare
            bar only (buttons keep their clicks), close is an explicit ×. */}
        <div
          className="terminal-titlebar"
          onPointerDown={startDrag}
          onPointerMove={onDragMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <span className="terminal-drawer-title">
            <TerminalIcon size={13} />
            <span className="terminal-titlebar-name">
              {activeSession.id === RUN_SESSION_ID
                ? t('terminal.title')
                : `${t('terminal.title')} ${sessions.indexOf(activeSession) + 1}`}
            </span>
          </span>
          <span className="terminal-drawer-actions">
            <button
              type="button"
              className="terminal-win-btn"
              onClick={toggle}
              title={t('terminal.close')}
              aria-label={t('terminal.close')}
            >
              <CloseIcon size={12} />
            </button>
          </span>
        </div>
        <div ref={bodyRef} className="terminal-drawer-body editor-console">
          {entries.length === 0 ? (
            <div className="terminal-drawer-banner">
              <span>{t('terminal.banner.version')}</span>
              <span>{t('terminal.banner.copyright')}</span>
            </div>
          ) : (
            entries.map((e, i) => (
              <div key={i} className={`editor-console-line is-${e.stream}`}>
                <span className="editor-console-text">{e.text}</span>
              </div>
            ))
          )}
        </div>
        <form
          className="terminal-drawer-input"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(draft);
          }}
        >
          <span className="terminal-prompt" aria-hidden="true">
            {`${cwd}>`}
          </span>
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            disabled={busy}
            aria-label={t('terminal.input')}
          />
        </form>
      </div>
    </div>
  );
}
