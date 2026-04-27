// lib/drive-sync.ts
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { Category } from '../types.ts';

export const STATE_FOLDERS: Category[] = ['pending', 'active', 'done', 'cancelled'];

export function buildDrivePath(
  root: string,
  driveFolder: string,
  subprojectKey: string,
  state: Category,
  filename: string,
): string {
  return join(root, driveFolder, subprojectKey, state, filename);
}

export function copyToDrive(sourceAbs: string, targetAbs: string): void {
  mkdirSync(dirname(targetAbs), { recursive: true });
  copyFileSync(sourceAbs, targetAbs);
}

export function moveDriveFile(fromAbs: string, toAbs: string): void {
  if (fromAbs === toAbs) return;
  mkdirSync(dirname(toAbs), { recursive: true });
  if (existsSync(toAbs)) unlinkSync(toAbs);
  renameSync(fromAbs, toAbs);
}

export interface FoundDrivePlan {
  absolutePath: string;
  subproject: string;
  state: Category;
  filename: string;
}

export function findDriveFiles(
  root: string,
  driveFolder: string,
  jiraKey: string,
): FoundDrivePlan[] {
  const results: FoundDrivePlan[] = [];
  const base = join(root, driveFolder);
  if (!existsSync(base)) return results;
  // 지원 파일명 패턴:
  //   "<JIRA_KEY>-<slug>.md"
  //   "<YYYY-MM-DD>-<JIRA_KEY>-<slug>.md"  (팀 관행)
  //   "<JIRA_KEY>.md"  (slug 없는 경우)
  const keyEscaped = jiraKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const keyPattern = new RegExp(`(?:^|-)${keyEscaped}(?=[-.])`);
  for (const subproject of readdirSync(base)) {
    const subBase = join(base, subproject);
    if (!statSync(subBase).isDirectory()) continue;
    for (const state of STATE_FOLDERS) {
      const stateDir = join(subBase, state);
      if (!existsSync(stateDir)) continue;
      for (const entry of readdirSync(stateDir)) {
        if (keyPattern.test(entry)) {
          results.push({
            absolutePath: join(stateDir, entry),
            subproject,
            state,
            filename: entry,
          });
        }
      }
    }
  }
  return results;
}

// 편의 함수: 첫 번째 매치 1개만 반환 (기존 호환)
export function findDriveFile(
  root: string,
  driveFolder: string,
  jiraKey: string,
): FoundDrivePlan | null {
  const all = findDriveFiles(root, driveFolder, jiraKey);
  return all[0] ?? null;
}

export function ensureDriveFolders(root: string, driveFolder: string, subprojectKey: string): void {
  for (const state of STATE_FOLDERS) {
    mkdirSync(join(root, driveFolder, subprojectKey, state), { recursive: true });
  }
}
