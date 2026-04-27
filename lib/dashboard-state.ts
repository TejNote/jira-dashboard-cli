// lib/dashboard-state.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { DashboardIssueEntry, DashboardState } from '../types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = join(__dirname, '..', 'state', 'dashboard.json');

export function loadState(path: string = STATE_PATH): DashboardState {
  if (!existsSync(path)) {
    return { generated_at: new Date().toISOString(), issues: [] };
  }
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw) as DashboardState;
}

export function saveState(state: DashboardState, path: string = STATE_PATH): void {
  state.generated_at = new Date().toISOString();
  writeFileSync(path, JSON.stringify(state, null, 2), 'utf8');
}

export function upsertIssue(state: DashboardState, entry: DashboardIssueEntry): void {
  const idx = state.issues.findIndex(i => i.key === entry.key);
  if (idx >= 0) {
    state.issues[idx] = { ...state.issues[idx], ...entry };
  } else {
    state.issues.push(entry);
  }
}

export function findIssue(state: DashboardState, key: string): DashboardIssueEntry | undefined {
  return state.issues.find(i => i.key === key);
}
