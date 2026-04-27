// lib/jira-client.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runClaude, extractJson } from './claude-runner.ts';
import type { JiraIssue } from '../types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = join(__dirname, '..', 'prompts', 'jira-query.md');
const BASE_CWD = join(__dirname, '..'); // jira-dashboard 루트 — MCP 접근만 하므로 cwd는 무관

export interface QueryOptions {
  cwd?: string;
  timeoutMs?: number;
}

export async function queryJira(jql: string, opts: QueryOptions = {}): Promise<JiraIssue[]> {
  const template = readFileSync(PROMPT_PATH, 'utf8');
  const prompt = template.replace('{{JQL}}', jql);

  const result = await runClaude({
    cwd: opts.cwd ?? BASE_CWD,
    prompt,
    // Jira MCP 도구 두 네임스페이스 모두 허용
    allowedTools: [
      'mcp__jira__jira_search_issues',
      'mcp__jira__jira_search_issues_summary',
      'mcp__jira__jira_get_issue',
      'mcp__claude_ai_Atlassian__searchJiraIssuesUsingJql',
      'mcp__claude_ai_Atlassian__getJiraIssue',
    ],
    timeoutMs: opts.timeoutMs ?? 2 * 60 * 1000,
  });

  if (result.exitCode !== 0 || result.timedOut) {
    throw new Error(
      `Jira query failed (exit=${result.exitCode}, timedOut=${result.timedOut}): ${result.stderr.slice(0, 400)}`,
    );
  }

  const parsed = extractJson<{ issues: JiraIssue[] }>(result.stdout);
  if (!Array.isArray(parsed.issues)) {
    throw new Error(`Unexpected Jira query output shape: ${JSON.stringify(parsed).slice(0, 200)}`);
  }
  return parsed.issues;
}

export function buildAssignedActiveJql(projectKey: string, accountId: string): string {
  // assignee = accountId 로 지정하면 다른 사용자 환경에서도 동일 결과
  return (
    `project = ${projectKey} ` +
    `AND assignee = "${accountId}" ` +
    `AND statusCategory in (new, indeterminate) ` +
    `ORDER BY updated DESC`
  );
}

export function buildAllIssuesJql(projectKey: string, accountId: string): string {
  // 상태 동기화용: 완료/취소 포함 전체
  return (
    `project = ${projectKey} ` +
    `AND assignee = "${accountId}" ` +
    `ORDER BY updated DESC`
  );
}
