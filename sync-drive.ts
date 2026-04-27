// sync-drive.ts
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { loadConfig } from './lib/config.ts';
import { queryJira, buildAllIssuesJql } from './lib/jira-client.ts';
import {
  buildDrivePath,
  findDriveFiles,
  moveDriveFile,
} from './lib/drive-sync.ts';
import { normalizeCategory, detectCancelledByDeletion } from './lib/normalize.ts';
import { loadState, saveState } from './lib/dashboard-state.ts';
import { createLogger, type Logger } from './lib/logger.ts';
import type { BoardConfig, RootConfig } from './types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function syncBoard(
  cfg: RootConfig,
  boardKey: string,
  board: BoardConfig,
  log: Logger = createLogger('sync'),
): Promise<void> {
  log.info(`[${boardKey}] sync 시작`);
  const jql = buildAllIssuesJql(board.project_key, cfg.jira.assignee_account_id);
  const remote = await queryJira(jql);
  const remoteKeys = new Set(remote.map(i => i.key));

  const state = loadState();

  // 원격에 있는 이슈: 정규화 → 필요 시 Drive 파일(들) 이동
  // 한 이슈가 여러 subproject 에 플랜을 가질 수 있으므로 findDriveFiles 로 전부 수집
  for (const issue of remote) {
    const target = normalizeCategory(issue, board, cfg.defaults);
    const foundAll = findDriveFiles(cfg.google_drive_root, board.drive_folder, issue.key);
    if (foundAll.length === 0) continue; // 플랜 없는 이슈는 09:00 poll 담당
    const existing = state.issues.find(i => i.key === issue.key);
    if (existing) {
      existing.status_raw = issue.status.name;
      existing.status_category = issue.status.statusCategory.key;
      existing.status_normalized = target;
    }
    for (const found of foundAll) {
      if (found.state === target) continue;
      const toAbs = buildDrivePath(
        cfg.google_drive_root, board.drive_folder,
        found.subproject, target, found.filename,
      );
      moveDriveFile(found.absolutePath, toAbs);
      log.info(`[${boardKey}] ${issue.key} [${found.subproject}]: ${found.state} → ${target} 이동`);
      if (existing) {
        for (const p of existing.plans) {
          if (p.subproject === found.subproject) p.drive_path = toAbs;
        }
      }
    }
  }

  // 로컬(dashboard.json 기준)에는 있는데 원격에 없는 이슈 → cancelled 이동 (여러 파일 모두)
  const localKeysForBoard = new Set(
    state.issues.filter(i => i.board === boardKey).map(i => i.key),
  );
  const cancelled = detectCancelledByDeletion(localKeysForBoard, remoteKeys);
  for (const key of cancelled) {
    const foundAll = findDriveFiles(cfg.google_drive_root, board.drive_folder, key);
    if (foundAll.length === 0) continue;
    const existing = state.issues.find(i => i.key === key);
    if (existing) existing.status_normalized = 'cancelled';
    for (const found of foundAll) {
      if (found.state === 'cancelled') continue;
      const toAbs = buildDrivePath(
        cfg.google_drive_root, board.drive_folder,
        found.subproject, 'cancelled', found.filename,
      );
      moveDriveFile(found.absolutePath, toAbs);
      log.info(`[${boardKey}] ${key} [${found.subproject}]: 삭제됨 → cancelled 이동`);
      if (existing) {
        for (const p of existing.plans) {
          if (p.subproject === found.subproject) p.drive_path = toAbs;
        }
      }
    }
  }

  saveState(state);
  log.info(`[${boardKey}] sync 완료`);
}

async function main(): Promise<void> {
  const log = createLogger('sync');
  try {
    const cfg = loadConfig();
    for (const [boardKey, board] of Object.entries(cfg.boards)) {
      try {
        await syncBoard(cfg, boardKey, board, log);
      } catch (e) {
        log.error(`[${boardKey}] sync 실패: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    log.error(`치명: ${(e as Error).message}`);
    process.exit(1);
  }
}

// standalone 실행 감지: process.argv[1] 이 이 파일로 끝나는지로 판단
if (process.argv[1] && process.argv[1].endsWith('sync-drive.ts')) {
  main();
}
