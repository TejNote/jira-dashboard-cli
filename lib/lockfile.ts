// lib/lockfile.ts
import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';

export class LockError extends Error {}

export function acquire(lockPath: string): () => void {
  if (existsSync(lockPath)) {
    const pid = readFileSync(lockPath, 'utf8').trim();
    // 살아있는 프로세스인지 확인
    let alive = false;
    try {
      process.kill(Number(pid), 0);
      alive = true;
    } catch {
      alive = false;
    }
    if (alive) {
      throw new LockError(`Lock held by pid ${pid} at ${lockPath}`);
    }
    // stale lock — 제거
    unlinkSync(lockPath);
  }
  const fd = openSync(lockPath, 'w');
  writeSync(fd, String(process.pid));
  closeSync(fd);

  return () => {
    try { unlinkSync(lockPath); } catch { /* ignore */ }
  };
}
