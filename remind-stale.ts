// remind-stale.ts
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { loadConfig } from './lib/config.ts';
import { loadState, saveState } from './lib/dashboard-state.ts';
import { sendTelegram } from './lib/telegram.ts';
import { createLogger } from './lib/logger.ts';
import { acquire, LockError } from './lib/lockfile.ts';
import { syncBoard } from './sync-drive.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCK_PATH = join(__dirname, 'state', 'remind.lock');

function todayKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function hoursBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 3600_000;
}

async function main(): Promise<void> {
  const log = createLogger('remind');
  log.info('remind 시작');

  let releaseLock = () => { /* noop */ };
  try {
    releaseLock = acquire(LOCK_PATH);
  } catch (e) {
    if (e instanceof LockError) {
      log.warn(`잠금 점유됨: ${e.message}`);
      return;
    }
    throw e;
  }

  try {
    const cfg = loadConfig();

    // 먼저 sync-drive 실행해 최신 상태 반영
    for (const [boardKey, board] of Object.entries(cfg.boards)) {
      try {
        await syncBoard(cfg, boardKey, board, log);
      } catch (e) {
        log.error(`[${boardKey}] sync 실패: ${(e as Error).message}`);
      }
    }

    const state = loadState();
    const now = new Date();
    const todayStr = todayKey(now);

    const byBoard = new Map<string, string[]>();

    for (const issue of state.issues) {
      if (issue.status_normalized !== 'pending') continue;
      const createdAt = new Date(issue.plan_created_at);
      if (hoursBetween(now, createdAt) < 24) continue;
      if (issue.last_reminded_at?.startsWith(todayStr)) continue;

      const board = cfg.boards[issue.board];
      const sess = board?.session ?? issue.board;
      const lines = byBoard.get(sess) ?? [];
      lines.push(
        `• ${issue.key}: ${issue.title}\n  → 생성: ${issue.plan_created_at.slice(0, 16).replace('T', ' ')} / 상태: ${issue.status_raw}\n  → 진행: "${issue.key} 진행해"\n  → 보류: "${issue.key} 보류"`,
      );
      byBoard.set(sess, lines);
      issue.last_reminded_at = now.toISOString();
    }

    if (byBoard.size === 0) {
      log.info('리마인드 대상 없음');
    } else {
      const sections = [...byBoard.entries()].map(([sess, lines]) =>
        `[${sess}]\n${lines.join('\n')}`,
      );
      const msg =
        `⏰ 미착수 플랜 리마인드\n\n` +
        `어제 생성됐지만 아직 시작 안 한 작업:\n\n` +
        sections.join('\n\n') +
        `\n\n(상태가 진행중/완료로 바뀌면 리마인드 자동 중지)`;
      await sendTelegram(msg);
      log.info(`리마인드 ${[...byBoard.values()].reduce((s, a) => s + a.length, 0)}건 전송`);
    }

    saveState(state);
  } finally {
    releaseLock();
  }
}

main().catch((e) => {
  const log = createLogger('remind');
  log.error(`치명: ${(e as Error).stack ?? (e as Error).message}`);
  sendTelegram(`❌ Jira 대시보드 remind 실패\n${(e as Error).message.slice(0, 300)}`)
    .catch(() => { /* ignore */ })
    .finally(() => process.exit(1));
});
