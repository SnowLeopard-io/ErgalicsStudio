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
  type ReplMagic,
} from '@/core/pyodide/repl-commands';
import { runHostCommand } from '@/core/terminal/host-commands';
import {
  engineForFile,
  pythonRunProgram,
  resolvePath,
  runScriptFile,
} from '@/core/terminal/run-file';
import { toProjectPath } from '@/core/workspace/open-file';
import { readProjectFile } from '@/core/workspace/project-files';
import { useProjectStore } from '@/stores/projectStore';
import { useTerminalWindow } from './useTerminalWindow';
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

/** Commands that read or write the project tree in the interpreter — they
 *  need the workspace to be mounted first. */
function needsWorkspace(magic: ReplMagic): boolean {
  return (
    magic === 'ls' ||
    magic === 'cd' ||
    magic === 'cat' ||
    magic === 'head' ||
    magic === 'tail' ||
    magic === 'tree' ||
    magic === 'find' ||
    magic === 'grep' ||
    magic === 'wc' ||
    magic === 'run'
  );
}

export function TerminalPanel() {
  const t = useT();

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
  // Every session sits in its own directory: the prompt shows the ACTIVE
  // session's directory, and a `cd` in one session does not move another.
  const cwd = activeSession.cwd;

  const clearActive = useMemo(
    () =>
      activeSession.id === RUN_SESSION_ID
        ? clearRunConsole
        : () => useTerminalStore.getState().clearSession(activeSession.id),
    [activeSession.id, clearRunConsole],
  );

  // Every session sits in its own directory (see `cwd` below): the prompt
  // shows the ACTIVE session's directory.

  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  /** Per-session input history (↑/↓), keyed by session id. */
  const historyRef = useRef<Record<string, string[]>>({});
  const [history, setHistory] = useState<string[]>([]);
  /** Position in `history` while browsing: -1 = live draft. */
  const [historyIdx, setHistoryIdx] = useState(-1);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  /** Latest capture runner — the open effect below runs before the callback
   *  that defines it is created. */
  const runCapturedRef = useRef<(code: string) => Promise<{ out: string; err: string }>>(
    async () => ({ out: '', err: '' }),
  );

  // Window geometry (drag / resize / persistence) lives in its own hook.
  const { rect, startResize, onResizeMove, endResize, startDrag, onDragMove, endDrag } =
    useTerminalWindow();

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
      try {
        const mounted = await mountWorkspaceFiles();
        if (!alive || !mounted) return;
        // The mount resets the interpreter's directory; the sessions keep
        // their own, so nothing to update here.
      } catch {
        // The interpreter may still be booting or the runtime failed: the
        // next command retries the mount.
      }
    })();
    // Focus after the open transition so the window is ready to type into.
    const timer = window.setTimeout(() => inputRef.current?.focus(), 180);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [open]);

  // A hidden window must not keep the keyboard focus: aria-hidden alone
  // leaves the focused button inside the subtree, which browsers report as
  // an accessibility error. `inert` (React 18 has no JSX prop for it) both
  // removes the subtree from the a11y tree and drops the focus.
  useEffect(() => {
    const el = windowRef.current;
    if (!el) return;
    if (open) {
      el.removeAttribute('inert');
      return;
    }
    el.setAttribute('inert', '');
    const active = document.activeElement;
    if (active instanceof HTMLElement && el.contains(active)) active.blur();
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
    const max = Math.max(60, Math.floor((rect.height || 340) / 3));
    area.style.height = `${Math.min(area.scrollHeight, max)}px`;
  }, [draft, rect.height]);

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
  const runCaptured = useCallback(
    async (code: string, preloadSource?: string): Promise<{ out: string; err: string }> => {
      const result = await getPythonRuntime().repl(
        `_capture(${pythonLiteral(code)})`,
        // `_capture` hides the user's source from Pyodide's import scanner, so
        // hand it the raw text (or the script source) for auto-loading.
        preloadSource ?? code,
      );
      if (!result.ok) return { out: '', err: result.error ?? 'error' };
      const payload = decodeCapture(result.text);
      if (payload) return payload;
      // No capture helper (older worker): fall back to the plain channel.
      return { out: result.text, err: '' };
    },
    [],
  );
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
        // The runpy wrapper never shows the file's imports to the worker, so
        // pass the source along for on-demand package loading.
        let source: string | undefined;
        try {
          source = await readProjectFile(projectPath);
        } catch {
          source = undefined;
        }
        const { out, err } = await runCaptured(pythonRunProgram(abs), source);
        if (out) append('stdout', out);
        if (err) append('stderr', err);
        const pwd = await runCaptured("print(__import__('os').getcwd())");
        const path = pwd.out.trim();
        if (path) setCwdStore(activeSession.id, path);
        return;
      }
      if (!useProjectStore.getState().project) {
        append('stderr', 'run: no project open');
        return;
      }
      try {
        const raw = await readProjectFile(projectPath);
        const result = await runScriptFile(projectPath, raw);
        if (result.stdout) append('stdout', result.stdout);
        if (!result.ok) append('stderr', result.error ?? 'run failed');
        else append('info', `finished ${projectPath}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        append('stderr', `run: ${message}`);
      }
    },
    [cwd, activeSession.id, runCaptured, setCwdStore],
  );

  /**
   * Write the files the session created or changed back into the project.
   * Runs before a workspace rebuild (so nothing the user wrote in the
   * terminal is lost) and after a script run (so its artefacts land in the
   * project tree).
   */
  const syncWorkspaceToProject = useCallback(
    async (append: (stream: 'stdout' | 'stderr' | 'info', text: string) => void) => {
      const produced = await collectWorkspaceOutputsFromRuntime();
      const names = [
        ...Object.keys(produced.files),
        ...Object.keys(produced.binaryFiles),
      ];
      if (!names.length) return;
      await useAppStore.getState().saveWorkspaceFiles(produced.files, produced.binaryFiles);
      useAppStore.getState().bumpFileOps();
      append('info', `saved ${names.length} file(s) to the project: ${names.join(', ')}`);
    },
    [],
  );

  // Every session has its own directory. The interpreter has ONE working
  // directory, so before a command runs we move it to the active session's
  // directory — that way `cd` in session 2 does not move session 1.
  const syncInterpreterCwd = useCallback(
    async (sessionId: string, target: string) => {
      const { out, err } = await runCapturedRef.current(
        `import os\nif os.path.isdir(${pythonLiteral(target)}):\n    os.chdir(${pythonLiteral(target)})\nelse:\n    os.chdir('/workspace')`,
      );
      if (err) return;
      const path = out.trim();
      if (path && path !== target) {
        // The directory vanished (e.g. the project changed): fall back.
        useTerminalStore.getState().setCwd(sessionId, path, false);
      }
    },
    [],
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

        // Commands that touch the file system need the project tree in the
        // interpreter. The mount is FORCED here: a run may have left the
        // bundled example files behind, and `ls` must show the project tree
        // as it is on disk. Whatever the session wrote goes back into the
        // project first, so a rebuild never loses it.
        if (cmd && needsWorkspace(cmd.magic)) {
          await syncWorkspaceToProject(appendActive);
          const mounted = await mountWorkspaceFiles(true);
          if (!mounted) {
            appendActive('stderr', 'the Python workspace is not ready yet');
            return;
          }
          // The rebuild reset the interpreter's directory — put it back where
          // THIS session is.
          await syncInterpreterCwd(sessionId, cwd);
        }

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
          await syncWorkspaceToProject(appendActive);
          return;
        }

        // `cd -` returns to the directory this session was in before the last
        // cd (the shell's OLDPWD).
        let cdArg = cmd?.arg ?? '';
        let effective = cmd;
        if (cmd?.magic === 'cd' && cdArg === '-') {
          cdArg = activeSession.prevCwd;
          effective = { ...cmd, arg: cdArg };
        } else if (cmd?.magic === 'cd') {
          // A relative cd resolves against THIS session's directory.
          await syncInterpreterCwd(sessionId, cwd);
        }

        const code = effective ? buildMagicPython(effective) : text;
        const { out, err } = await runCaptured(code);
        if (out) appendActive('stdout', out);
        if (err) appendActive('stderr', err);
        // `cd` moved the interpreter's working directory: re-read it so the
        // prompt shows where we actually are — and remember it for THIS
        // session only.
        if (cmd?.magic === 'cd') {
          const pwd = await runCaptured("print(__import__('os').getcwd())");
          const path = pwd.out.trim();
          if (path) setCwdStore(sessionId, path);
        }
      } finally {
        setBusy(false);
      }
    },
    [
      busy,
      activeSession.id,
      activeSession.prevCwd,
      cwd,
      appendActive,
      clearActive,
      setCwdStore,
      runCaptured,
      runScript,
      syncInterpreterCwd,
      syncWorkspaceToProject,
    ],
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

  const style: React.CSSProperties = {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };

  return (
    <div
      ref={windowRef}
      className={`terminal-window${open ? '' : ' is-closed'}`}
      style={style}
      aria-hidden={!open}
      role="complementary"
      aria-label={t('terminal.title')}
    >
      {/* Window-style resize grips: all four edges and corners, placed just
          OUTSIDE the frame so they never fight with the title bar or the
          session strip. */}
      {(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const).map((dir) => (
        <div
          key={dir}
          className={`terminal-resize is-${dir}`}
          onPointerDown={startResize(dir)}
          onPointerMove={onResizeMove}
          onPointerUp={endResize}
          onPointerCancel={endResize}
        />
      ))}

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
