// poll-jira.ts
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { loadConfig } from './lib/config.ts';
import { queryJira, buildAssignedActiveJql } from './lib/jira-client.ts';
import { runClaude, extractJson } from './lib/claude-runner.ts';
import { normalizeCategory } from './lib/normalize.ts';
import { parseFrontmatter } from './lib/frontmatter.ts';
import { loadState, saveState, upsertIssue } from './lib/dashboard-state.ts';
import {
  buildDrivePath,
  copyToDrive,
  ensureDriveFolders,
} from './lib/drive-sync.ts';
import { sendTelegram } from './lib/telegram.ts';
import { createLogger } from './lib/logger.ts';
import { acquire, LockError } from './lib/lockfile.ts';
import { dateKST, isoKST } from './lib/time.ts';
import type {
  BoardConfig,
  DashboardIssueEntry,
  JiraIssue,
  RootConfig,
} from './types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = join(__dirname, 'prompts', 'plan-writer.md');
const LOCK_PATH = join(__dirname, 'state', 'poll.lock');

interface CliFlags {
  dryRun: boolean;
  board: string | null;
  forceIssue: string | null;
}

function parseCli(argv: string[]): CliFlags {
  const flags: CliFlags = { dryRun: false, board: null, forceIssue: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--board') flags.board = argv[++i];
    else if (a === '--issue') flags.forceIssue = argv[++i];
  }
  return flags;
}

function listMarkdown(baseDir: string): string[] {
  const result: string[] = [];
  function walk(dir: string, rel: string): void {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const sub = rel ? `${rel}/${entry}` : entry;
      if (statSync(full).isDirectory()) walk(full, sub);
      else if (entry.endsWith('.md')) result.push(sub);
    }
  }
  if (existsSync(baseDir)) walk(baseDir, '');
  return result;
}

async function existingPlanKeys(board: BoardConfig): Promise<Set<string>> {
  const keys = new Set<string>();
  for (const sp of board.subprojects) {
    const plansDir = join(board.parent_workspace, sp.path, 'plans');
    for (const entry of listMarkdown(plansDir)) {
      const full = join(plansDir, entry);
      try {
        const text = readFileSync(full, 'utf8');
        const { data } = parseFrontmatter(text);
        keys.add(data.jira);
      } catch {
        // frontmatter 파싱 실패 시 파일명에서라도 키 추출
        // 지원 패턴: "JIRA-123-xxx.md" 또는 "YYYY-MM-DD-JIRA-123-xxx.md"
        const m = entry.match(/^(?:\d{4}-\d{2}-\d{2}-)?([A-Z]+-\d+)/);
        if (m) keys.add(m[1]);
      }
    }
  }
  return keys;
}

interface WriterResult {
  plans: Array<{ subproject: string; area: string; path: string; absolute_path: string }>;
}

async function runPlanWriter(
  _cfg: RootConfig,
  board: BoardConfig,
  issue: JiraIssue,
): Promise<WriterResult> {
  const template = readFileSync(PROMPT_PATH, 'utf8');
  const now = new Date();
  const prompt = template
    .replace('{{ISSUE_JSON}}', JSON.stringify(issue, null, 2))
    .replace('{{PARENT_WORKSPACE}}', board.parent_workspace)
    .replace('{{SUBPROJECTS_JSON}}', JSON.stringify(board.subprojects, null, 2))
    .replace('{{NOW_ISO}}', isoKST(now))
    .replace('{{TODAY_DATE}}', dateKST(now));

  const result = await runClaude({
    cwd: board.parent_workspace,
    prompt,
    allowedTools: ['Read', 'Glob', 'Grep', 'Write', 'Bash', 'Task'],
    timeoutMs: 5 * 60 * 1000,
  });

  if (result.exitCode !== 0 || result.timedOut) {
    throw new Error(
      `plan-writer failed (exit=${result.exitCode}, timedOut=${result.timedOut}): ${result.stderr.slice(0, 400)}`,
    );
  }

  return extractJson<WriterResult>(result.stdout);
}

async function main(): Promise<void> {
  const log = createLogger('poll');
  const flags = parseCli(process.argv.slice(2));
  log.info(`poll start (dryRun=${flags.dryRun}, board=${flags.board ?? 'all'}, issue=${flags.forceIssue ?? '-'})`);

  let releaseLock = () => { /* noop */ };
  try {
    releaseLock = acquire(LOCK_PATH);
  } catch (e) {
    if (e instanceof LockError) {
      log.warn(`다른 인스턴스가 실행 중, 종료: ${e.message}`);
      return;
    }
    throw e;
  }

  try {
    const cfg = loadConfig();
    const state = loadState();
    const summary: string[] = [];

    const boardsToRun: Record<string, BoardConfig> = flags.board
      ? (cfg.boards[flags.board] ? { [flags.board]: cfg.boards[flags.board] } : {})
      : cfg.boards;

    for (const [boardKey, board] of Object.entries(boardsToRun)) {
      if (!board) {
        log.error(`알 수 없는 보드: ${boardKey}`);
        continue;
      }
      log.info(`[${boardKey}] 조회 시작`);
      const jql = buildAssignedActiveJql(board.project_key, cfg.jira.assignee_account_id);
      let issues: JiraIssue[];
      try {
        issues = await queryJira(jql);
      } catch (e) {
        const msg = (e as Error).message;
        log.error(`[${boardKey}] Jira 조회 실패: ${msg}`);
        await sendTelegram(`❌ Jira 대시보드 09:00 실행 실패 (${boardKey})\n에러: ${msg.slice(0, 200)}`);
        continue;
      }
      log.info(`[${boardKey}] ${issues.length}건 조회`);

      const existing = await existingPlanKeys(board);
      const boardSummaryLines: string[] = [];

      for (const issue of issues) {
        if (!flags.forceIssue && existing.has(issue.key)) {
          log.info(`[${boardKey}] ${issue.key} 이미 플랜 존재, skip`);
          continue;
        }
        if (flags.forceIssue && issue.key !== flags.forceIssue) continue;

        // 이 이슈의 현재 상태 normalization (신규 생성 시엔 대개 pending)
        const normalized = normalizeCategory(issue, board, cfg.defaults);

        if (flags.dryRun) {
          log.info(`[${boardKey}] ${issue.key} (dry-run) 플랜 생성 skip`);
          boardSummaryLines.push(`• ${issue.key}: ${issue.title} (dry-run)`);
          continue;
        }

        let planResult: WriterResult;
        try {
          planResult = await runPlanWriter(cfg, board, issue);
        } catch (e) {
          const msg = (e as Error).message;
          log.error(`[${boardKey}] ${issue.key} 플랜 작성 실패: ${msg}`);
          boardSummaryLines.push(`• ${issue.key}: ❌ 플랜 실패`);
          continue;
        }

        // 각 생성 파일을 Drive로 복사 + 엔트리 누적
        const planEntries: DashboardIssueEntry['plans'] = [];
        for (const p of planResult.plans) {
          const sourceAbs = p.absolute_path;
          const filename = sourceAbs.split('/').pop()!;
          const driveAbs = buildDrivePath(
            cfg.google_drive_root,
            board.drive_folder,
            p.subproject,
            normalized,
            filename,
          );
          try {
            ensureDriveFolders(cfg.google_drive_root, board.drive_folder, p.subproject);
            copyToDrive(sourceAbs, driveAbs);
          } catch (e) {
            log.error(`[${boardKey}] Drive 복사 실패: ${sourceAbs} → ${driveAbs}: ${(e as Error).message}`);
          }
          planEntries.push({
            subproject: p.subproject,
            area: p.area,
            path: p.path,
            drive_path: driveAbs,
          });
        }

        const entry: DashboardIssueEntry = {
          key: issue.key,
          title: issue.title,
          board: boardKey,
          status_raw: issue.status.name,
          status_category: issue.status.statusCategory.key,
          status_normalized: normalized,
          jira_url: `${cfg.jira.host}/browse/${issue.key}`,
          plans: planEntries,
          plan_created_at: new Date().toISOString(),
          last_reminded_at: null,
        };
        upsertIssue(state, entry);
        log.info(`[${boardKey}] ${issue.key} 플랜 ${planEntries.length}개 생성 완료`);

        const areas = Array.from(new Set(planEntries.map(p => p.area))).join(', ');
        boardSummaryLines.push(`• ${issue.key}: ${issue.title}\n  영역: ${areas} (${planEntries.length}파일)\n  → "${issue.key} 진행해" 로 시작`);
      }

      if (boardSummaryLines.length > 0) {
        summary.push(`[${board.session}]\n${boardSummaryLines.join('\n')}`);
      }
    }

    saveState(state);

    if (summary.length > 0) {
      const prefix = flags.dryRun ? '🧪 [DRY-RUN] ' : '🆕 ';
      const msg = `${prefix}오늘의 신규 플랜 (${summary.length}보드)\n\n${summary.join('\n\n')}\n\n조회: Drive/플랜/`;
      await sendTelegram(msg);
    } else {
      log.info('신규 플랜 없음, 텔레그램 알림 생략');
    }

    log.info('poll 종료');
  } finally {
    releaseLock();
  }
}

main().catch((e) => {
  const log = createLogger('poll');
  log.error(`치명 에러: ${(e as Error).stack ?? (e as Error).message}`);
  sendTelegram(`❌ Jira 대시보드 poll 치명 실패\n${(e as Error).message.slice(0, 300)}`)
    .catch(() => { /* ignore */ })
    .finally(() => process.exit(1));
});
