// lib/claude-runner.ts
import { spawn } from 'node:child_process';

export interface ClaudeRunOptions {
  cwd: string;
  prompt: string;
  allowedTools: string[];      // 예: ["Read","Glob","Grep","Write","Bash","Task"]
  timeoutMs?: number;          // 기본 5분
  claudeBin?: string;          // 기본 'claude'
  extraArgs?: string[];        // 필요 시 추가 인자
}

export interface ClaudeRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
}

export async function runClaude(opts: ClaudeRunOptions): Promise<ClaudeRunResult> {
  const start = Date.now();
  const claudeBin = opts.claudeBin ?? 'claude';
  const timeout = opts.timeoutMs ?? 5 * 60 * 1000;

  const args = [
    '-p', opts.prompt,
    '--output-format', 'json',
    '--allowedTools', opts.allowedTools.join(','),
    ...(opts.extraArgs ?? []),
  ];

  return await new Promise<ClaudeRunResult>((resolve) => {
    const child = spawn(claudeBin, args, {
      cwd: opts.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000);
    }, timeout);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        exitCode: code ?? -1,
        timedOut,
        durationMs: Date.now() - start,
      });
    });
  });
}

export function extractJson<T>(raw: string): T {
  // Claude CLI의 --output-format json 은 이벤트 stream 1개 혹은 최종 content 출력.
  // 마지막 유효 JSON 오브젝트 또는 배열을 추출한다.
  const trimmed = raw.trim();

  // 전체가 JSON인 경우 — result wrapper 여부 확인
  try {
    const top = JSON.parse(trimmed);
    if (top && typeof top === 'object') {
      // Claude CLI --output-format json 의 result wrapper 처리
      // { type: "result", result: "```json\n{...}\n```" } 형태
      if ('result' in top && typeof top.result === 'string') {
        const inner = extractJsonFromText<T>(top.result);
        if (inner !== null) return inner;
      }
      // wrapper 없이 바로 목표 객체인 경우
      return top as T;
    }
  } catch { /* fall through */ }

  // 줄 단위 JSON 이벤트 스트림인 경우: 마지막으로 보이는 content JSON 블록 탐색
  const lines = trimmed.split('\n').reverse();
  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;
    try {
      const obj = JSON.parse(s);
      if (obj && typeof obj === 'object') {
        if ('result' in obj && typeof obj.result === 'string') {
          const inner = extractJsonFromText<T>(obj.result);
          if (inner !== null) return inner;
        }
        return obj as T;
      }
    } catch { /* skip */ }
  }

  // 마지막 수단: 텍스트 전체에서 JSON 블록 탐색
  const fromText = extractJsonFromText<T>(trimmed);
  if (fromText !== null) return fromText;

  throw new Error(`Failed to extract JSON from Claude output:\n${raw.slice(0, 400)}`);
}

/** 텍스트(마크다운 포함)에서 JSON 오브젝트/배열을 추출한다. */
function extractJsonFromText<T>(text: string): T | null {
  // 마크다운 코드블록 ``` ... ``` 내부 추출
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim()) as T;
    } catch { /* fall through */ }
  }
  // 중괄호/대괄호로 시작하는 JSON 직접 탐색
  const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1]) as T;
    } catch { /* fall through */ }
  }
  return null;
}
