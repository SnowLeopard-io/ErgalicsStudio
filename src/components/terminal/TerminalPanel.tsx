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
import {
  collectWorkspaceOutputsFromRuntime,
  getPythonRuntime,
  mountWorkspaceFiles,
} from '@/core/pyodide/code-runtime';
import {
  buildMagicPython,
  isClearCommand,
  isHostCommand,
  parseReplCommand,
  pythonLiteral,
} from '@/core/pyodide/repl-commands';
import { runHostCommand } from '@/core/terminal/host-commands';
import {
  engineForFile,
  pythonRunProgram,
  resolvePath,
  runScriptFile,
} from '@/core/terminal/run-file';
import { toProjectPath } from '@/core/workspace/open-file';
import { getVfs } from '@/core/vfs';
import { getProjectRepoPath, useProjectStore } from '@/stores/projectStore';
import { CloseIcon, PlusIcon, TerminalIcon } from '@/components/icons';

/**
 * Decode the base64(JSON) payload returned by the studio module's
 * `_capture` helper. The repl channel hands back the Python repr of the
 * returned string, so the surrounding quotes are stripped first.
 */
function decodeCapture(repr: string): { out: string; err: string } | null {
  let b64 = repr.trim();
  if (b64.startsWith("'") && b64.endsWith("'")) b64 = b64.slice(1, -1);
  if (!b64) return null;
  try {
    const json = atob(b64);
    const parsed = JSON.parse(json) as { out?: string; err?: string };
    if (typeof parsed.out !== 'string' && typeof parsed.err !== 'string') return null;
    return { out: parsed.out ?? '', err: parsed.err ?? '' };
  } catch {
    return null;
  }
}

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

/**
 * True when the buffer is an unfinished block: the line ends with ':' (a
 * Python header) or brackets are still open. Enter then continues the block
 * instead of submitting it.
 */
export function needsContinuation(text: string): boolean {
  const trimmed = text.trimEnd();
  if (!trimmed) return false;
  if (trimmed.endsWith(':')) return true;
  const opens = (text.match(/[([{]/g) ?? []).length;
  const closes = (text.match(/[)\]}]/g) ?? []).length;
  return opens > closes;
}

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

  // The interpreter has ONE working directory — the prompt shows it for every
  // session (a `cd` anywhere moves all of them).
  const cwd = useTerminalStore((s) => s.cwd);

  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  /** Per-session input history (↑/↓), keyed by session id. */
  const historyRef = useRef<Record<string, string[]>>({});
  const [history, setHistory] = useState<string[]>([]);
  /** Position in `history` while browsing: -1 = live draft. */
  const [historyIdx, setHistoryIdx] = useState(-1);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** Latest capture runner — the open effect below runs before the callback
   *  that defines it is created. */
  const runCapturedRef = useRef<(code: string) => Promise<{ out: string; err: string }>>(
    async () => ({ out: '', err: '' }),
  );

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
  // interpreter immediately (silent: no runtime-notice chrome for a preempt)
  // and materialise the project tree in it — `ls` / `cd data` must work
  // before the user ever presses 运行.
  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    void (async () => {
      const mounted = await mountWorkspaceFiles();
      if (!alive || !mounted) return;
      // The mount resets the cwd to /workspace; re-read it for the prompt.
      const pwd = await runCapturedRef.current("print(__import__('os').getcwd())");
      const path = pwd.out.trim();
      if (path) useTerminalStore.getState().setCwd(path);
    })();
    // Focus after the open transition so the window is ready to type into.
    const timer = window.setTimeout(() => inputRef.current?.focus(), 180);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [open]);

  // Keep the latest output visible, like a real terminal.
  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [entries]);

  // The input grows with the buffer (a multi-line Python block needs room)
  // but never takes more than a third of the window.
  useEffect(() => {
    const area = inputRef.current;
    if (!area) return;
    area.style.height = 'auto';
    const max = Math.max(60, Math.floor((size.h || 340) / 3));
    area.style.height = `${Math.min(area.scrollHeight, max)}px`;
  }, [draft, size.h]);

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

  /**
   * Run one command in the interpreter and capture ITS output.
   *
   * The plain repl channel streams stdout into the global console — which
   * belongs to the run session, so a command typed in session 2 would print
   * into session 1. The studio module's `_capture` helper redirects both
   * streams into buffers and hands them back base64-encoded, so every
   * session owns exactly its own output.
   */
  const runCaptured = useCallback(async (code: string): Promise<{ out: string; err: string }> => {
    const result = await getPythonRuntime().repl(`_capture(${pythonLiteral(code)})`);
    if (!result.ok) return { out: '', err: result.error ?? 'error' };
    const payload = decodeCapture(result.text);
    if (payload) return payload;
    // No capture helper (older worker): fall back to the plain channel.
    return { out: result.text, err: '' };
  }, []);
  runCapturedRef.current = runCaptured;

  /**
   * Run a script file, dispatching on its type: Python runs inside the
   * session interpreter (so its output belongs to this terminal session),
   * JavaScript / R run in the workbench engines.
   */
  const runScript = useCallback(
    async (arg: string, append: (stream: 'stdout' | 'stderr' | 'info', text: string) => void) => {
      const target = arg.trim();
      if (!target) {
        append('stderr', 'run: missing file argument');
        return;
      }
      const abs = resolvePath(cwd, target);
      const projectPath = toProjectPath(abs);
      const engine = engineForFile(projectPath);
      if (engine === 'python') {
        const { out, err } = await runCaptured(pythonRunProgram(abs));
        if (out) append('stdout', out);
        if (err) append('stderr', err);
        const pwd = await runCaptured("print(__import__('os').getcwd())");
        const path = pwd.out.trim();
        if (path) setCwdStore(path);
        return;
      }
      const project = useProjectStore.getState().project;
      if (!project) {
        append('stderr', 'run: no project open');
        return;
      }
      try {
        const adapter = getVfs();
        const raw = await adapter.readFile(getProjectRepoPath(project), projectPath);
        const result = await runScriptFile(projectPath, raw);
        if (result.stdout) append('stdout', result.stdout);
        if (!result.ok) append('stderr', result.error ?? 'run failed');
        else append('info', `finished ${projectPath}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        append('stderr', `run: ${message}`);
      }
    },
    [cwd, runCaptured, setCwdStore],
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

        // Host commands act on the workbench (open / touch / git / pip …).
        if (cmd && isHostCommand(cmd.magic)) {
          await runHostCommand(cmd, { append: appendActive, cwd, runPython: runCaptured });
          return;
        }

        // `run` dispatches on the file type: Python runs in the session
        // interpreter, JS / R run in the workbench engines.
        if (cmd?.magic === 'run') {
          await runScript(cmd.arg, appendActive);
          // Whatever the script wrote into the workspace goes back into the
          // project — the terminal must not be a dead end for artefacts.
          const produced = await collectWorkspaceOutputsFromRuntime();
          const names = Object.keys(produced);
          if (names.length) {
            await useAppStore.getState().saveWorkspaceFiles(produced);
            useAppStore.getState().bumpFileOps();
            appendActive('info', `saved ${names.length} file(s) to the project: ${names.join(', ')}`);
          }
          return;
        }

        const code = cmd ? buildMagicPython(cmd) : text;
        const { out, err } = await runCaptured(code);
        if (out) appendActive('stdout', out);
        if (err) appendActive('stderr', err);
        // `cd` moved the interpreter's working directory: re-read it so the
        // prompt shows where we actually are.
        if (cmd?.magic === 'cd') {
          const pwd = await runCaptured("print(__import__('os').getcwd())");
          const path = pwd.out.trim();
          if (path) setCwdStore(path);
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, activeSession.id, cwd, appendActive, clearActive, setCwdStore, runCaptured, runScript],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      // Shift+Enter always inserts a newline; a plain Enter continues the
      // block when the line ends with ':' or leaves brackets open (Python
      // `def` / `if` blocks), otherwise it submits.
      if (e.shiftKey) {
        e.preventDefault();
        insertNewline();
        return;
      }
      if (needsContinuation(draft)) {
        e.preventDefault();
        insertNewline();
        return;
      }
      e.preventDefault();
      void submit(draft);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      insertIndent(e.shiftKey);
      return;
    }
    // History navigation only makes sense for a single-line buffer.
    if (draft.includes('\n')) return;
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

  /** Insert a newline, keeping the current indentation (plus one level when
   *  the line ends with ':'). */
  const insertNewline = () => {
    const area = inputRef.current;
    const caret = area?.selectionStart ?? draft.length;
    const before = draft.slice(0, caret);
    const indent = before.match(/^[ \t]*/)?.[0] ?? '';
    const extra = before.trimEnd().endsWith(':') ? '    ' : '';
    const next = `${before}\n${indent}${extra}${draft.slice(caret)}`;
    setDraft(next);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      const pos = before.length + 1 + indent.length + extra.length;
      el.selectionStart = pos;
      el.selectionEnd = pos;
      el.focus();
    });
  };

  /** Tab indents the current line (Shift+Tab dedents it). */
  const insertIndent = (outdent: boolean) => {
    const area = inputRef.current;
    const caret = area?.selectionStart ?? draft.length;
    const lineStart = draft.lastIndexOf('\n', caret - 1) + 1;
    const line = draft.slice(lineStart);
    const nextLine = outdent ? line.replace(/^ {1,4}/, '') : `    ${line}`;
    const next = draft.slice(0, lineStart) + nextLine + draft.slice(lineStart + line.length);
    setDraft(next);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.selectionStart = lineStart + nextLine.length;
      el.selectionEnd = lineStart + nextLine.length;
      el.focus();
    });
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
          <textarea
            ref={inputRef}
            className="terminal-input-area"
            value={draft}
            rows={1}
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
