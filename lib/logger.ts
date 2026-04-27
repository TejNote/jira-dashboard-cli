// lib/logger.ts
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const LOG_DIR = join(homedir(), '.local', 'logs', 'jira-dashboard');

function ensureLogDir(): void {
  mkdirSync(LOG_DIR, { recursive: true });
}

function today(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

function nowLine(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export type Level = 'INFO' | 'WARN' | 'ERROR';

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  filePath: string;
}

export function createLogger(component: 'poll' | 'remind' | 'sync'): Logger {
  ensureLogDir();
  const filePath = join(LOG_DIR, `${component}-${today()}.log`);
  const errorsPath = join(LOG_DIR, 'errors.log');

  function write(level: Level, msg: string): void {
    const line = `[${nowLine()}] ${level.padEnd(5)} ${component}: ${msg}\n`;
    appendFileSync(filePath, line);
    if (level === 'ERROR') appendFileSync(errorsPath, line);
    process.stdout.write(line);
  }

  return {
    info: (msg) => write('INFO', msg),
    warn: (msg) => write('WARN', msg),
    error: (msg) => write('ERROR', msg),
    filePath,
  };
}
