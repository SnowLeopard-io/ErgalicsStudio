export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let minLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

function format(level: LogLevel, scope: string): string {
  const time = new Date().toISOString();
  return `[${time}] [${level.toUpperCase()}] [${scope}]`;
}

export const logger = {
  debug(scope: string, ...args: unknown[]): void {
    if (LEVEL_ORDER.debug < LEVEL_ORDER[minLevel]) return;
    console.debug(format('debug', scope), ...args);
  },
  info(scope: string, ...args: unknown[]): void {
    if (LEVEL_ORDER.info < LEVEL_ORDER[minLevel]) return;
    console.info(format('info', scope), ...args);
  },
  warn(scope: string, ...args: unknown[]): void {
    if (LEVEL_ORDER.warn < LEVEL_ORDER[minLevel]) return;
    console.warn(format('warn', scope), ...args);
  },
  error(scope: string, ...args: unknown[]): void {
    console.error(format('error', scope), ...args);
  },
};
