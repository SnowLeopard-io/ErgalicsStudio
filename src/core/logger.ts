export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let minLevel: LogLevel = 'info';

/**
 * Buffered log records. A bounded ring is kept so a long session cannot grow
 * memory without limit, while the tail is always available for the
 * diagnostics export (analysing a failed run after the fact is impossible
 * from a console the user already scrolled past).
 */
export interface LogRecord {
  /** ISO-8601 timestamp. */
  at: string;
  level: LogLevel;
  scope: string;
  /** Pre-formatted single-line message (args already rendered). */
  message: string;
}

const DEFAULT_BUFFER_SIZE = 500;
let bufferSize = DEFAULT_BUFFER_SIZE;
const buffer: LogRecord[] = [];

export interface LoggerOptions {
  /** Minimum level that reaches the console. */
  level?: LogLevel;
  /** Number of records kept for export. `0` disables buffering. */
  bufferSize?: number;
}

/**
 * Configure the logger. `setLogLevel` remains for callers that only care
 * about the console threshold.
 */
export function configureLogger(options: LoggerOptions): void {
  if (options.level) minLevel = options.level;
  if (typeof options.bufferSize === 'number' && Number.isFinite(options.bufferSize)) {
    bufferSize = Math.max(0, Math.floor(options.bufferSize));
    trim();
  }
}

export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

function trim(): void {
  if (buffer.length > bufferSize) buffer.splice(0, buffer.length - bufferSize);
}

/**
 * Render an argument for the buffered record. `String(err)` loses the stack
 * and `JSON.stringify` throws on cycles and drops `Error` entirely, so both
 * of those cases are handled explicitly.
 */
function render(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) {
    // Collapse the redundant "Name: same-name" (e.g. Monaco's `Canceled`
    // sentinel where name === message === 'Canceled') so logged errors read
    // like "Canceled" instead of the confusing "Canceled: Canceled".
    const label = value.name && value.name !== value.message ? `${value.name}: ` : '';
    return `${label}${value.message}`;
  }
  if (value === null || value === undefined) return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function format(level: LogLevel, scope: string): string {
  const time = new Date().toISOString();
  return `[${time}] [${level.toUpperCase()}] [${scope}]`;
}

function record(level: LogLevel, scope: string, args: unknown[]): void {
  if (bufferSize <= 0) return;
  buffer.push({ at: new Date().toISOString(), level, scope, message: args.map(render).join(' ') });
  trim();
}

function emit(level: LogLevel, scope: string, args: unknown[]): void {
  record(level, scope, args);
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
  const prefix = format(level, scope);
  if (level === 'error') console.error(prefix, ...args);
  else if (level === 'warn') console.warn(prefix, ...args);
  else if (level === 'debug') console.debug(prefix, ...args);
  else console.info(prefix, ...args);
}

export const logger = {
  debug(scope: string, ...args: unknown[]): void {
    emit('debug', scope, args);
  },
  info(scope: string, ...args: unknown[]): void {
    emit('info', scope, args);
  },
  warn(scope: string, ...args: unknown[]): void {
    emit('warn', scope, args);
  },
  error(scope: string, ...args: unknown[]): void {
    // Errors are always written to the console — a suppressed error is worse
    // than a noisy one — and always buffered.
    record('error', scope, args);
    console.error(format('error', scope), ...args);
  },
  /** Snapshot of the buffered records (oldest first). */
  entries(): LogRecord[] {
    return buffer.map((r) => ({ ...r }));
  },
  /** Machine-readable export (a JSON array of records). */
  exportJson(): string {
    return JSON.stringify(buffer, null, 2);
  },
  /** Human-readable export, one `[time] [LEVEL] [scope] message` per line. */
  exportText(): string {
    return buffer.map((r) => `[${r.at}] [${r.level.toUpperCase()}] [${r.scope}] ${r.message}`).join('\n');
  },
  clear(): void {
    buffer.length = 0;
  },
};
