# Jira Work Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jira에 배정된 업무를 매일 09:00 자동 수집해 각 subproject의 `plans/` 폴더에 플랜 파일을 생성하고, Jira 상태를 기반으로 Google Drive 4분류 폴더(pending/active/done/cancelled)로 동기화하며, 미착수 건은 10:00에 텔레그램으로 리마인드한다.

**Architecture:** Node/TypeScript + launchd 스케줄링. 핵심 로직은 `~/Documents/Claude/scripts/jira-dashboard/` 에 배치. Jira 조회와 플랜 작성 모두 headless `claude -p` 를 경유하여 Jira MCP 및 프로젝트 컨텍스트(CLAUDE.md, memory)에 접근. 4분류 정규화(`lib/normalize.ts`)와 `dashboard.json` 스냅샷을 Phase 2 웹 대시보드 재사용을 위한 독립 모듈로 분리.

**Tech Stack:** Node 20+, TypeScript 5, Vitest, `yaml`, `gray-matter`, `zod`, 기존 Claude CLI (`/opt/homebrew/bin/claude` 또는 동등), Telegram Bot API, launchd.

**Spec Reference:** `docs/superpowers/specs/2026-04-17-jira-work-dashboard-design.md`

---

## File Structure

**Create in `~/Documents/Claude/scripts/jira-dashboard/`:**

| 파일 | 책임 |
|------|------|
| `package.json` | 의존성 + npm scripts |
| `tsconfig.json` | TS 컴파일 설정 |
| `vitest.config.ts` | 테스트 설정 |
| `.gitignore` | node_modules, state/, logs |
| `types.ts` | 공통 타입 (BoardConfig, JiraIssue, Plan, DashboardState) |
| `lib/config.ts` | `boards.yaml` 로드 + zod 검증 |
| `lib/config.test.ts` | 설정 로더 테스트 |
| `lib/normalize.ts` | Jira 상태 → 4분류 매핑 |
| `lib/normalize.test.ts` | 매핑 테스트 |
| `lib/frontmatter.ts` | YAML frontmatter 파싱/생성 |
| `lib/frontmatter.test.ts` | frontmatter 테스트 |
| `lib/logger.ts` | 파일 로거 (`~/.local/logs/jira-dashboard/`) |
| `lib/lockfile.ts` | 중복 실행 방지 |
| `lib/telegram.ts` | Telegram Bot 메시지 전송 |
| `lib/dashboard-state.ts` | `state/dashboard.json` read/write |
| `lib/drive-sync.ts` | Google Drive 파일 I/O (copy, move, glob) |
| `lib/drive-sync.test.ts` | Drive 동기화 테스트 |
| `lib/claude-runner.ts` | headless `claude -p` exec + JSON 파싱 |
| `lib/jira-client.ts` | Jira 조회 (claude-runner 경유) |
| `prompts/plan-writer.md` | 플랜 작성용 Claude 프롬프트 템플릿 |
| `prompts/jira-query.md` | Jira 조회용 Claude 프롬프트 템플릿 |
| `poll-jira.ts` | 09:00 메인 오케스트레이터 |
| `sync-drive.ts` | Jira 상태 → Drive 폴더 동기화 (standalone 실행 가능) |
| `remind-stale.ts` | 10:00 미착수 리마인드 |

**Modify:**

| 파일 | 변경 내용 |
|------|-----------|
| `~/Documents/Insudeal/CeoReport/CLAUDE.md` | Jira 플랜 자동 실행 규칙 블록 추가 |
| `~/Documents/Insudeal/Metlife/CLAUDE.md` | 동일 블록 추가 |
| 각 subproject `/.gitignore` | `plans/` 라인 추가 |

**New launchd plists:**

| 파일 | 역할 |
|------|------|
| `~/Library/LaunchAgents/com.pakjungeol.jira-dashboard-poll.plist` | 09:00 매일 |
| `~/Library/LaunchAgents/com.pakjungeol.jira-dashboard-remind.plist` | 10:00 매일 |
| `~/.local/bin/jira-dashboard-poll.sh` | launchd → Node 실행 래퍼 |
| `~/.local/bin/jira-dashboard-remind.sh` | 동일 |

---

## Prerequisites

- Node 20 이상 (`node --version`으로 확인)
- `claude` CLI 설치 및 Jira MCP 로그인 완료 (`mcp__jira__*` 또는 `mcp__claude_ai_Atlassian__*` 도구 사용 가능)
- Telegram Bot 토큰 + chat_id (기존 daily-news와 동일) — `~/.<service>/.env`에 보관, 코드/plan에 평문 금지
- Google Drive 데스크톱 앱 로그인 (`/Users/pakjungeol/Library/CloudStorage/GoogleDrive-leaf9016@gmail.com/` 경로 접근 가능)

---

## Task 1: 프로젝트 스캐폴딩

**Files:**
- Create: `~/Documents/Claude/scripts/jira-dashboard/package.json`
- Create: `~/Documents/Claude/scripts/jira-dashboard/tsconfig.json`
- Create: `~/Documents/Claude/scripts/jira-dashboard/vitest.config.ts`
- Create: `~/Documents/Claude/scripts/jira-dashboard/.gitignore`
- Create: `~/Documents/Claude/scripts/jira-dashboard/state/.gitkeep`
- Create: `~/Documents/Claude/scripts/jira-dashboard/lib/.gitkeep`
- Create: `~/Documents/Claude/scripts/jira-dashboard/prompts/.gitkeep`

- [ ] **Step 1: package.json 작성**

```json
{
  "name": "jira-dashboard",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "poll": "tsx poll-jira.ts",
    "remind": "tsx remind-stale.ts",
    "sync": "tsx sync-drive.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "gray-matter": "^4.0.3",
    "yaml": "^2.5.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^20.12.0",
    "tsx": "^4.15.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: tsconfig.json 작성**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noImplicitAny": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: vitest.config.ts 작성**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['**/*.test.ts'],
  },
});
```

- [ ] **Step 4: .gitignore 작성**

```
node_modules/
state/dashboard.json
state/*.lock
.vitest/
```

- [ ] **Step 5: 디렉터리 마커 생성**

```bash
mkdir -p ~/Documents/Claude/scripts/jira-dashboard/{state,lib,prompts}
touch ~/Documents/Claude/scripts/jira-dashboard/state/.gitkeep
touch ~/Documents/Claude/scripts/jira-dashboard/lib/.gitkeep
touch ~/Documents/Claude/scripts/jira-dashboard/prompts/.gitkeep
```

- [ ] **Step 6: 의존성 설치**

Run: `cd ~/Documents/Claude/scripts/jira-dashboard && npm install`
Expected: `added N packages, no vulnerabilities` 출력.

- [ ] **Step 7: 커밋**

```bash
cd ~/Documents/Claude
git add scripts/jira-dashboard/package.json \
        scripts/jira-dashboard/tsconfig.json \
        scripts/jira-dashboard/vitest.config.ts \
        scripts/jira-dashboard/.gitignore \
        scripts/jira-dashboard/state/.gitkeep \
        scripts/jira-dashboard/lib/.gitkeep \
        scripts/jira-dashboard/prompts/.gitkeep
git commit -m "$(cat <<'EOF'
chore(jira-dashboard): 프로젝트 스캐폴딩

- Node 20+, TypeScript 5, Vitest 기반 설정
- yaml, gray-matter, zod 의존성
- state/dashboard.json 은 runtime 생성물로 gitignore

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 공통 타입 정의

**Files:**
- Create: `~/Documents/Claude/scripts/jira-dashboard/types.ts`

- [ ] **Step 1: types.ts 작성**

```typescript
// ~/Documents/Claude/scripts/jira-dashboard/types.ts

export type Category = 'pending' | 'active' | 'done' | 'cancelled';
export type JiraStatusCategoryKey = 'new' | 'indeterminate' | 'done';

export interface Subproject {
  key: string;
  path: string;
  description: string;
}

export interface BoardConfig {
  project_key: string;
  board_id: number;
  session: string;
  parent_workspace: string;
  drive_folder: string;
  subprojects: Subproject[];
  name_overrides: Record<string, Category>;
}

export interface CancelledDetection {
  on_deletion: boolean;
  on_resolution: string[];
}

export interface Defaults {
  category_map: Record<JiraStatusCategoryKey, Category>;
  cancelled_detection: CancelledDetection;
}

export interface RootConfig {
  jira: {
    host: string;
    assignee_account_id: string;
  };
  defaults: Defaults;
  google_drive_root: string;
  boards: Record<string, BoardConfig>;
}

export interface JiraStatus {
  name: string;
  statusCategory: {
    key: JiraStatusCategoryKey;
  };
}

export interface JiraResolution {
  name: string;
}

export interface JiraIssue {
  key: string;
  title: string;
  body: string;
  status: JiraStatus;
  resolution: JiraResolution | null;
  labels: string[];
  components: string[];
  updated: string; // ISO 8601
}

export interface PlanFrontmatter {
  jira: string;
  title: string;
  area: string;
  subproject: string;
  related: string[];
  suggested_branch: string;
  jira_url: string;
  created: string; // ISO 8601
}

export interface PlanFile {
  path: string; // 프로젝트 내 상대 경로 (예: "ceo-report-backend/plans/JIRA-CEOR-123-xxx.md")
  absolute_path: string;
  drive_path: string; // Drive 절대 경로
  frontmatter: PlanFrontmatter;
}

export interface DashboardIssueEntry {
  key: string;
  title: string;
  board: string;
  status_raw: string;
  status_category: JiraStatusCategoryKey;
  status_normalized: Category;
  jira_url: string;
  plans: Array<{
    subproject: string;
    area: string;
    path: string;         // subproject 내 상대 경로
    drive_path: string;   // 현재 Drive 상 절대 경로
  }>;
  plan_created_at: string;
  last_reminded_at: string | null;
}

export interface DashboardState {
  generated_at: string;
  issues: DashboardIssueEntry[];
}
```

- [ ] **Step 2: 타입 체크 실행**

Run: `cd ~/Documents/Claude/scripts/jira-dashboard && npx tsc --noEmit`
Expected: 에러 없음 (exit 0).

- [ ] **Step 3: 커밋**

```bash
cd ~/Documents/Claude
git add scripts/jira-dashboard/types.ts
git commit -m "$(cat <<'EOF'
feat(jira-dashboard): 공통 타입 정의

- Category (4분류), BoardConfig, JiraIssue, PlanFrontmatter, DashboardState

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Config 로더 (TDD)

**Files:**
- Create: `~/Documents/Claude/scripts/jira-dashboard/lib/config.ts`
- Create: `~/Documents/Claude/scripts/jira-dashboard/lib/config.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
// lib/config.test.ts
import { describe, it, expect } from 'vitest';
import { loadConfig, parseConfig } from './config.ts';

describe('parseConfig', () => {
  it('loads boards.yaml and validates against schema', () => {
    const yaml = `
jira:
  host: https://example.atlassian.net
  assignee_account_id: "abc123"
defaults:
  category_map:
    new: pending
    indeterminate: active
    done: done
  cancelled_detection:
    on_deletion: true
    on_resolution: ["Won't Do"]
google_drive_root: /tmp/drive
boards:
  X:
    project_key: X
    board_id: 1
    session: x
    parent_workspace: /tmp/x
    drive_folder: x
    subprojects:
      - key: backend
        path: x-backend
        description: "X backend"
    name_overrides: {}
`;
    const config = parseConfig(yaml);
    expect(config.boards.X.project_key).toBe('X');
    expect(config.boards.X.subprojects).toHaveLength(1);
    expect(config.defaults.category_map.new).toBe('pending');
  });

  it('throws on missing required field', () => {
    const yaml = `jira:\n  host: https://example.atlassian.net\n`;
    expect(() => parseConfig(yaml)).toThrow();
  });

  it('loads real boards.yaml from disk', () => {
    const config = loadConfig();
    expect(config.boards.CEOR).toBeDefined();
    expect(config.boards.UT).toBeDefined();
    expect(config.boards.UT.name_overrides['비스포크 보류']).toBe('cancelled');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd ~/Documents/Claude/scripts/jira-dashboard && npx vitest run lib/config.test.ts`
Expected: `Cannot find module './config.ts'` 로 FAIL.

- [ ] **Step 3: config.ts 구현**

```typescript
// lib/config.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { RootConfig } from '../types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = join(__dirname, '..', 'boards.yaml');

const CategorySchema = z.enum(['pending', 'active', 'done', 'cancelled']);

const SubprojectSchema = z.object({
  key: z.string(),
  path: z.string(),
  description: z.string(),
});

const BoardConfigSchema = z.object({
  project_key: z.string(),
  board_id: z.number().int().positive(),
  session: z.string(),
  parent_workspace: z.string(),
  drive_folder: z.string(),
  subprojects: z.array(SubprojectSchema).min(1),
  name_overrides: z.record(z.string(), CategorySchema).default({}),
});

const RootConfigSchema = z.object({
  jira: z.object({
    host: z.string().url(),
    assignee_account_id: z.string(),
  }),
  defaults: z.object({
    category_map: z.object({
      new: CategorySchema,
      indeterminate: CategorySchema,
      done: CategorySchema,
    }),
    cancelled_detection: z.object({
      on_deletion: z.boolean(),
      on_resolution: z.array(z.string()),
    }),
  }),
  google_drive_root: z.string(),
  boards: z.record(z.string(), BoardConfigSchema),
});

export function parseConfig(yamlText: string): RootConfig {
  const raw = parseYaml(yamlText);
  return RootConfigSchema.parse(raw) as RootConfig;
}

export function loadConfig(path: string = DEFAULT_CONFIG_PATH): RootConfig {
  const text = readFileSync(path, 'utf8');
  return parseConfig(text);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd ~/Documents/Claude/scripts/jira-dashboard && npx vitest run lib/config.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 5: 커밋**

```bash
cd ~/Documents/Claude
git add scripts/jira-dashboard/lib/config.ts scripts/jira-dashboard/lib/config.test.ts
git commit -m "$(cat <<'EOF'
feat(jira-dashboard): boards.yaml 로더 + zod 검증

- parseConfig: YAML 문자열 → 검증된 RootConfig
- loadConfig: 기본 경로(boards.yaml) 에서 읽어 파싱

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Normalize 모듈 (TDD)

**Files:**
- Create: `~/Documents/Claude/scripts/jira-dashboard/lib/normalize.ts`
- Create: `~/Documents/Claude/scripts/jira-dashboard/lib/normalize.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
// lib/normalize.test.ts
import { describe, it, expect } from 'vitest';
import {
  normalizeCategory,
  detectCancelledByDeletion,
} from './normalize.ts';
import type { BoardConfig, Defaults, JiraIssue } from '../types.ts';

const defaults: Defaults = {
  category_map: { new: 'pending', indeterminate: 'active', done: 'done' },
  cancelled_detection: { on_deletion: true, on_resolution: ["Won't Do", 'Duplicate'] },
};

const ceorBoard: BoardConfig = {
  project_key: 'CEOR', board_id: 14, session: 'ceo',
  parent_workspace: '/tmp/ceo', drive_folder: 'ceo',
  subprojects: [{ key: 'backend', path: 'be', description: '' }],
  name_overrides: {},
};

const utBoard: BoardConfig = {
  ...ceorBoard, project_key: 'UT', board_id: 13, session: 'metlife',
  name_overrides: { '비스포크 보류': 'cancelled' },
};

function makeIssue(
  statusName: string,
  categoryKey: 'new' | 'indeterminate' | 'done',
  resolution: string | null = null,
): JiraIssue {
  return {
    key: 'X-1', title: '', body: '',
    status: { name: statusName, statusCategory: { key: categoryKey } },
    resolution: resolution ? { name: resolution } : null,
    labels: [], components: [], updated: '2026-04-17T00:00:00Z',
  };
}

describe('normalizeCategory', () => {
  it('maps statusCategory by default', () => {
    expect(normalizeCategory(makeIssue('해야 할 일', 'new'), ceorBoard, defaults)).toBe('pending');
    expect(normalizeCategory(makeIssue('진행 중', 'indeterminate'), ceorBoard, defaults)).toBe('active');
    expect(normalizeCategory(makeIssue('완료', 'done'), ceorBoard, defaults)).toBe('done');
  });

  it('applies name_overrides with highest priority', () => {
    const issue = makeIssue('비스포크 보류', 'done');
    expect(normalizeCategory(issue, utBoard, defaults)).toBe('cancelled');
  });

  it('detects cancelled from resolution field when status is done', () => {
    const issue = makeIssue('완료', 'done', "Won't Do");
    expect(normalizeCategory(issue, ceorBoard, defaults)).toBe('cancelled');
  });

  it('ignores resolution if status category is not done', () => {
    const issue = makeIssue('해야 할 일', 'new', "Won't Do");
    expect(normalizeCategory(issue, ceorBoard, defaults)).toBe('pending');
  });
});

describe('detectCancelledByDeletion', () => {
  it('returns keys present locally but missing remotely', () => {
    const local = new Set(['A-1', 'A-2', 'B-1']);
    const remote = new Set(['A-1', 'B-1']);
    expect(detectCancelledByDeletion(local, remote)).toEqual(['A-2']);
  });

  it('returns empty array when all local keys are present remotely', () => {
    const local = new Set(['A-1']);
    const remote = new Set(['A-1', 'A-2']);
    expect(detectCancelledByDeletion(local, remote)).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd ~/Documents/Claude/scripts/jira-dashboard && npx vitest run lib/normalize.test.ts`
Expected: `Cannot find module './normalize.ts'` FAIL.

- [ ] **Step 3: normalize.ts 구현**

```typescript
// lib/normalize.ts
import type { BoardConfig, Category, Defaults, JiraIssue } from '../types.ts';

export function normalizeCategory(
  issue: JiraIssue,
  board: BoardConfig,
  defaults: Defaults,
): Category {
  // 1순위: name_overrides
  const override = board.name_overrides[issue.status.name];
  if (override) return override;

  // 2순위: resolution (status가 done일 때만)
  const categoryKey = issue.status.statusCategory.key;
  if (categoryKey === 'done' && issue.resolution) {
    if (defaults.cancelled_detection.on_resolution.includes(issue.resolution.name)) {
      return 'cancelled';
    }
  }

  // 3순위: statusCategory 기본 매핑
  return defaults.category_map[categoryKey];
}

export function detectCancelledByDeletion(
  localKeys: Set<string>,
  remoteKeys: Set<string>,
): string[] {
  return [...localKeys].filter(k => !remoteKeys.has(k));
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd ~/Documents/Claude/scripts/jira-dashboard && npx vitest run lib/normalize.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 5: 커밋**

```bash
cd ~/Documents/Claude
git add scripts/jira-dashboard/lib/normalize.ts scripts/jira-dashboard/lib/normalize.test.ts
git commit -m "$(cat <<'EOF'
feat(jira-dashboard): Jira 상태 → 4분류 정규화

- name_overrides (1순위) > resolution (done일 때만) > statusCategory
- detectCancelledByDeletion: 로컬에만 있는 키 추출

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Frontmatter 모듈 (TDD)

**Files:**
- Create: `~/Documents/Claude/scripts/jira-dashboard/lib/frontmatter.ts`
- Create: `~/Documents/Claude/scripts/jira-dashboard/lib/frontmatter.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
// lib/frontmatter.test.ts
import { describe, it, expect } from 'vitest';
import { parseFrontmatter, stringifyFrontmatter } from './frontmatter.ts';
import type { PlanFrontmatter } from '../types.ts';

const sample: PlanFrontmatter = {
  jira: 'JIRA-CEOR-123',
  title: '고객사 리포트 API 추가',
  area: 'backend',
  subproject: 'ceo-report-backend',
  related: ['../ceo-report-frontend/plans/JIRA-CEOR-123-foo.md'],
  suggested_branch: 'feat/CEOR-123-customer-report-api',
  jira_url: 'https://insudeal.atlassian.net/browse/JIRA-CEOR-123',
  created: '2026-04-17T09:00:00+09:00',
};

describe('stringifyFrontmatter / parseFrontmatter roundtrip', () => {
  it('produces markdown with frontmatter and parses it back', () => {
    const body = '# JIRA-CEOR-123\n\n계획 본문';
    const md = stringifyFrontmatter(sample, body);
    expect(md.startsWith('---\n')).toBe(true);
    expect(md).toContain('jira: JIRA-CEOR-123');
    expect(md).toContain('계획 본문');

    const { data, content } = parseFrontmatter(md);
    expect(data.jira).toBe('JIRA-CEOR-123');
    expect(data.related).toEqual(sample.related);
    expect(content.trim()).toContain('계획 본문');
  });

  it('throws on missing required frontmatter fields', () => {
    const broken = '---\nfoo: bar\n---\n\nBody';
    expect(() => parseFrontmatter(broken)).toThrow();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd ~/Documents/Claude/scripts/jira-dashboard && npx vitest run lib/frontmatter.test.ts`
Expected: module not found FAIL.

- [ ] **Step 3: frontmatter.ts 구현**

```typescript
// lib/frontmatter.ts
import matter from 'gray-matter';
import { z } from 'zod';
import type { PlanFrontmatter } from '../types.ts';

const FrontmatterSchema = z.object({
  jira: z.string().min(1),
  title: z.string().min(1),
  area: z.string().min(1),
  subproject: z.string().min(1),
  related: z.array(z.string()).default([]),
  suggested_branch: z.string().min(1),
  jira_url: z.string().url(),
  created: z.string().min(1),
});

export function parseFrontmatter(md: string): { data: PlanFrontmatter; content: string } {
  const parsed = matter(md);
  const data = FrontmatterSchema.parse(parsed.data);
  return { data, content: parsed.content };
}

export function stringifyFrontmatter(data: PlanFrontmatter, content: string): string {
  // gray-matter의 stringify는 js-yaml을 사용하므로 직접 YAML 블록 조립
  const { stringify } = require('yaml') as typeof import('yaml');
  const yaml = stringify(data).trimEnd();
  return `---\n${yaml}\n---\n\n${content.trimStart()}`;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd ~/Documents/Claude/scripts/jira-dashboard && npx vitest run lib/frontmatter.test.ts`
Expected: 2 tests PASS.

- [ ] **Step 5: 커밋**

```bash
cd ~/Documents/Claude
git add scripts/jira-dashboard/lib/frontmatter.ts scripts/jira-dashboard/lib/frontmatter.test.ts
git commit -m "$(cat <<'EOF'
feat(jira-dashboard): 플랜 파일 frontmatter 파서/직렬화

- gray-matter + zod 로 필수 필드 검증
- stringifyFrontmatter: 표준 YAML 블록 + 본문 포맷

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Logger 모듈

**Files:**
- Create: `~/Documents/Claude/scripts/jira-dashboard/lib/logger.ts`

- [ ] **Step 1: logger.ts 작성**

```typescript
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
```

- [ ] **Step 2: 타입 체크**

Run: `cd ~/Documents/Claude/scripts/jira-dashboard && npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
cd ~/Documents/Claude
git add scripts/jira-dashboard/lib/logger.ts
git commit -m "$(cat <<'EOF'
feat(jira-dashboard): 파일 로거

- ~/.local/logs/jira-dashboard/{component}-YYYYMMDD.log
- 에러는 errors.log 에도 누적
- TCC 회피: Documents 밖 경로

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Lockfile 모듈

**Files:**
- Create: `~/Documents/Claude/scripts/jira-dashboard/lib/lockfile.ts`

- [ ] **Step 1: lockfile.ts 작성**

```typescript
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
```

- [ ] **Step 2: 타입 체크**

Run: `cd ~/Documents/Claude/scripts/jira-dashboard && npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
cd ~/Documents/Claude
git add scripts/jira-dashboard/lib/lockfile.ts
git commit -m "$(cat <<'EOF'
feat(jira-dashboard): 중복 실행 방지 lockfile

- PID 기록, stale(죽은 프로세스) 자동 회수
- release 함수로 정리

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Telegram 모듈

**Files:**
- Create: `~/Documents/Claude/scripts/jira-dashboard/lib/telegram.ts`

- [ ] **Step 1: telegram.ts 작성**

```typescript
// lib/telegram.ts
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
const DEFAULT_CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? '';
if (!BOT_TOKEN || !DEFAULT_CHAT_ID) {
  throw new Error('TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID env not set');
}

export interface SendOptions {
  chatId?: string;
  parseMode?: 'Markdown' | 'HTML';
  disablePreview?: boolean;
}

export async function sendTelegram(text: string, opts: SendOptions = {}): Promise<void> {
  const chatId = opts.chatId ?? DEFAULT_CHAT_ID;
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: chatId,
    text,
    parse_mode: opts.parseMode ?? 'Markdown',
    disable_web_page_preview: opts.disablePreview ?? true,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Telegram send failed (${res.status}): ${errText}`);
  }
}
```

- [ ] **Step 2: 타입 체크**

Run: `cd ~/Documents/Claude/scripts/jira-dashboard && npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 3: 수동 연동 확인** (선택적, 배포 전 한 번 수동 검증)

Run: `cd ~/Documents/Claude/scripts/jira-dashboard && npx tsx -e "import('./lib/telegram.ts').then(m => m.sendTelegram('[test] jira-dashboard hello'))"`
Expected: 텔레그램에 "[test] jira-dashboard hello" 수신. 확인 후 메시지는 남겨둬도 무방.

- [ ] **Step 4: 커밋**

```bash
cd ~/Documents/Claude
git add scripts/jira-dashboard/lib/telegram.ts
git commit -m "$(cat <<'EOF'
feat(jira-dashboard): Telegram 전송 유틸

- 기존 daily-news와 동일 토큰/chat_id 기본값
- Markdown 파싱, 웹 프리뷰 비활성

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Dashboard State 모듈

**Files:**
- Create: `~/Documents/Claude/scripts/jira-dashboard/lib/dashboard-state.ts`

- [ ] **Step 1: dashboard-state.ts 작성**

```typescript
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
```

- [ ] **Step 2: 타입 체크**

Run: `cd ~/Documents/Claude/scripts/jira-dashboard && npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
cd ~/Documents/Claude
git add scripts/jira-dashboard/lib/dashboard-state.ts
git commit -m "$(cat <<'EOF'
feat(jira-dashboard): dashboard.json 상태 파일 read/write/upsert

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Drive Sync 모듈 (TDD)

**Files:**
- Create: `~/Documents/Claude/scripts/jira-dashboard/lib/drive-sync.ts`
- Create: `~/Documents/Claude/scripts/jira-dashboard/lib/drive-sync.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
// lib/drive-sync.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildDrivePath,
  copyToDrive,
  moveDriveFile,
  findDriveFile,
} from './drive-sync.ts';

let root: string;

beforeEach(() => {
  root = join(tmpdir(), `drive-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('buildDrivePath', () => {
  it('assembles path from drive_folder / subproject / state / filename', () => {
    const p = buildDrivePath(root, 'ceo', 'backend', 'pending', 'JIRA-CEOR-1-foo.md');
    expect(p).toBe(join(root, 'ceo', 'backend', 'pending', 'JIRA-CEOR-1-foo.md'));
  });
});

describe('copyToDrive', () => {
  it('copies source file into target path, creating directories', () => {
    const source = join(root, 'source.md');
    writeFileSync(source, 'hello');
    const target = buildDrivePath(root, 'ceo', 'backend', 'pending', 'x.md');
    copyToDrive(source, target);
    expect(readFileSync(target, 'utf8')).toBe('hello');
  });
});

describe('moveDriveFile', () => {
  it('moves a file from one state folder to another', () => {
    const from = buildDrivePath(root, 'ceo', 'backend', 'pending', 'x.md');
    mkdirSync(join(root, 'ceo', 'backend', 'pending'), { recursive: true });
    writeFileSync(from, 'hello');
    const to = buildDrivePath(root, 'ceo', 'backend', 'active', 'x.md');
    moveDriveFile(from, to);
    expect(existsSync(from)).toBe(false);
    expect(readFileSync(to, 'utf8')).toBe('hello');
  });

  it('is idempotent when target already equals source', () => {
    const same = buildDrivePath(root, 'ceo', 'backend', 'pending', 'x.md');
    mkdirSync(join(root, 'ceo', 'backend', 'pending'), { recursive: true });
    writeFileSync(same, 'hello');
    moveDriveFile(same, same);
    expect(readFileSync(same, 'utf8')).toBe('hello');
  });
});

describe('findDriveFile', () => {
  it('finds an existing plan file across state folders by JIRA key', () => {
    const p = buildDrivePath(root, 'ceo', 'backend', 'active', 'JIRA-CEOR-7-foo.md');
    mkdirSync(join(root, 'ceo', 'backend', 'active'), { recursive: true });
    writeFileSync(p, 'body');
    const found = findDriveFile(root, 'ceo', 'JIRA-CEOR-7');
    expect(found).not.toBeNull();
    expect(found!.state).toBe('active');
    expect(found!.subproject).toBe('backend');
    expect(found!.absolutePath).toBe(p);
  });

  it('returns null when no file matches', () => {
    expect(findDriveFile(root, 'ceo', 'JIRA-NOPE')).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd ~/Documents/Claude/scripts/jira-dashboard && npx vitest run lib/drive-sync.test.ts`
Expected: module not found FAIL.

- [ ] **Step 3: drive-sync.ts 구현**

```typescript
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

export function findDriveFile(
  root: string,
  driveFolder: string,
  jiraKey: string,
): FoundDrivePlan | null {
  const base = join(root, driveFolder);
  if (!existsSync(base)) return null;
  for (const subproject of readdirSync(base)) {
    const subBase = join(base, subproject);
    if (!statSync(subBase).isDirectory()) continue;
    for (const state of STATE_FOLDERS) {
      const stateDir = join(subBase, state);
      if (!existsSync(stateDir)) continue;
      for (const entry of readdirSync(stateDir)) {
        if (entry.startsWith(`${jiraKey}-`) || entry === `${jiraKey}.md`) {
          return {
            absolutePath: join(stateDir, entry),
            subproject,
            state,
            filename: entry,
          };
        }
      }
    }
  }
  return null;
}

export function ensureDriveFolders(root: string, driveFolder: string, subprojectKey: string): void {
  for (const state of STATE_FOLDERS) {
    mkdirSync(join(root, driveFolder, subprojectKey, state), { recursive: true });
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd ~/Documents/Claude/scripts/jira-dashboard && npx vitest run lib/drive-sync.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 5: 커밋**

```bash
cd ~/Documents/Claude
git add scripts/jira-dashboard/lib/drive-sync.ts scripts/jira-dashboard/lib/drive-sync.test.ts
git commit -m "$(cat <<'EOF'
feat(jira-dashboard): Google Drive 파일 I/O (copy/move/find)

- buildDrivePath, copyToDrive, moveDriveFile (idempotent), findDriveFile
- 4분류 상태 폴더 상수 STATE_FOLDERS

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Claude Runner 모듈

**Files:**
- Create: `~/Documents/Claude/scripts/jira-dashboard/lib/claude-runner.ts`

- [ ] **Step 1: claude-runner.ts 작성**

```typescript
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
  // 전체가 JSON 인 경우
  try {
    return JSON.parse(trimmed) as T;
  } catch { /* fall through */ }
  // 줄 단위 JSON 이벤트 스트림인 경우: 마지막으로 보이는 content JSON 블록 탐색
  const lines = trimmed.split('\n').reverse();
  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;
    try {
      const obj = JSON.parse(s);
      if (obj && typeof obj === 'object') return obj as T;
    } catch { /* skip */ }
  }
  throw new Error(`Failed to extract JSON from Claude output:\n${raw.slice(0, 400)}`);
}
```

- [ ] **Step 2: 타입 체크**

Run: `cd ~/Documents/Claude/scripts/jira-dashboard && npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
cd ~/Documents/Claude
git add scripts/jira-dashboard/lib/claude-runner.ts
git commit -m "$(cat <<'EOF'
feat(jira-dashboard): headless claude -p 실행기

- 타임아웃 (기본 5분), allowedTools 목록, JSON 출력 파싱
- extractJson: 전체/마지막 라인 기준 fallback

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Jira Client 모듈

**Files:**
- Create: `~/Documents/Claude/scripts/jira-dashboard/lib/jira-client.ts`
- Create: `~/Documents/Claude/scripts/jira-dashboard/prompts/jira-query.md`

- [ ] **Step 1: 프롬프트 템플릿 작성**

```markdown
<!-- prompts/jira-query.md -->
Jira MCP(`mcp__jira__*` 또는 `mcp__claude_ai_Atlassian__*`) 중 사용 가능한 것을 사용해 아래 JQL로 이슈를 조회하고 결과를 JSON으로만 출력한다.

**JQL**:
```
{{JQL}}
```

**출력 포맷 (엄격 준수, 설명 문장 없이 JSON 한 개만)**:
```json
{
  "issues": [
    {
      "key": "ISSUE-KEY",
      "title": "요약 텍스트",
      "body": "설명 본문 (마크다운 원문, 없으면 빈 문자열)",
      "status": {
        "name": "상태 이름",
        "statusCategory": { "key": "new | indeterminate | done" }
      },
      "resolution": { "name": "해결" } /* 없으면 null */,
      "labels": ["..."],
      "components": ["..."],
      "updated": "ISO8601 문자열"
    }
  ]
}
```

**주의**:
- 모든 필드를 채워라. 없는 필드는 빈 문자열/빈 배열/null.
- 댓글은 body에 합쳐도 되지만 너무 길면 요약하지 말고 생략하고 `updated`는 이슈 자체의 updated 값.
- 결과 JSON 외 다른 출력 금지.
```

- [ ] **Step 2: jira-client.ts 작성**

```typescript
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
```

- [ ] **Step 3: 타입 체크**

Run: `cd ~/Documents/Claude/scripts/jira-dashboard && npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 4: 수동 통합 확인 (선택적, 배포 전 검증)**

Run:
```bash
cd ~/Documents/Claude/scripts/jira-dashboard
npx tsx -e "
import { loadConfig } from './lib/config.ts';
import { queryJira, buildAssignedActiveJql } from './lib/jira-client.ts';
const cfg = loadConfig();
const jql = buildAssignedActiveJql('CEOR', cfg.jira.assignee_account_id);
const issues = await queryJira(jql, { timeoutMs: 180000 });
console.log('Found', issues.length, 'issues');
console.log(JSON.stringify(issues.slice(0, 2), null, 2));
"
```
Expected: CEOR 에서 현재 pending/active 상태인 이슈 수와 샘플 2건 출력. 에러 시 프롬프트 출력 검토.

- [ ] **Step 5: 커밋**

```bash
cd ~/Documents/Claude
git add scripts/jira-dashboard/lib/jira-client.ts scripts/jira-dashboard/prompts/jira-query.md
git commit -m "$(cat <<'EOF'
feat(jira-dashboard): Jira 조회 클라이언트

- headless claude -p + Jira MCP 도구로 JQL 실행
- prompts/jira-query.md 템플릿: JSON 엄격 스키마 지시
- buildAssignedActiveJql / buildAllIssuesJql 헬퍼

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Plan Writer 프롬프트

**Files:**
- Create: `~/Documents/Claude/scripts/jira-dashboard/prompts/plan-writer.md`

- [ ] **Step 1: plan-writer.md 작성**

```markdown
<!-- prompts/plan-writer.md -->
당신은 Jira 이슈를 읽고 **실행 가능한 구현 플랜**을 작성하는 시니어 엔지니어입니다. 절차를 정확히 따르세요.

## 입력
아래 JSON이 이번 이슈의 전체 정보입니다:

```json
{{ISSUE_JSON}}
```

## 현재 작업 디렉터리
cwd = `{{PARENT_WORKSPACE}}`

## 하위 프로젝트 목록 (subprojects)
```json
{{SUBPROJECTS_JSON}}
```

## 수행 절차

1. 각 subproject의 `path/CLAUDE.md` 와 루트 구조를 `Read`/`Glob` 로 간단히 스캔해 프로젝트 성격을 파악한다.
2. 이슈 제목·본문·라벨·컴포넌트를 바탕으로 **영향받는 subproject 1~N개**를 결정한다.
   - 단일 영역만 해당되면 1개.
   - 백엔드 + 프론트엔드 등 양쪽 필요하면 2개 이상.
   - 판단이 모호하면 가장 가능성 높은 쪽을 선택하고 본문에 근거를 남긴다.
3. 선택된 각 subproject에 대해 `<path>/plans/<JIRA_KEY>-<slug>.md` 파일을 `Write` 로 생성한다.
   - `<slug>` 는 이슈 제목을 영문 kebab-case(소문자, 하이픈)로 변환한 3~6단어 요약.
   - 파일은 아래 frontmatter 규격을 반드시 포함한다.

## Frontmatter 규격 (모든 필드 필수)

```yaml
---
jira: <JIRA_KEY>
title: "<이슈 제목 원문>"
area: <subproject.key 값, 예: backend | frontend | noble-rich | simple-calc | insudeal-x-backend>
subproject: <subproject.path 값, 예: ceo-report-backend>
related: [<다른 영역 플랜의 상대 경로들 (없으면 [])>]
suggested_branch: feat/<PROJECT>-<번호>-<slug>
jira_url: https://insudeal.atlassian.net/browse/<JIRA_KEY>
created: <현재 ISO8601 시각 +09:00>
---
```

## 본문 구조 (필수 섹션)

```markdown
# <JIRA_KEY>: <제목>

## 배경
(이슈 본문 요약 및 왜 이 작업이 필요한지)

## 범위
- 포함: ...
- 제외: ...

## 영향 영역
- <area> (<subproject>)
- 다른 영역: (related 있을 때 상호 참조)

## 구현 단계
1. ...
2. ...
3. ...

## 검증 방법
- 단위 테스트: ...
- 수동 확인: ...

## 브랜치 제안
`feat/<PROJECT>-<번호>-<slug>` — 플랜 실행 시점에 사용자 확인 후 생성
```

## 중요 규칙

- **파일 경로는 cwd 기준 상대 경로**로 지정한다 (예: `ceo-report-backend/plans/JIRA-CEOR-123-foo.md`).
- 생성한 파일은 반드시 Write 도구로 작성한다. 다른 방식 금지.
- 한 이슈 = 여러 파일 가능. `related:` 로 상호 참조.
- 추측으로 존재하지 않는 파일·API를 본문에 적지 말고, 실제 코드 탐색으로 확인한 내용만 기입.
- 최종 출력은 아래 JSON 한 개만:

```json
{
  "plans": [
    {
      "subproject": "<subproject.key>",
      "area": "<area>",
      "path": "<cwd 기준 상대 경로>",
      "absolute_path": "<절대 경로>"
    }
  ]
}
```

JSON 외 설명·코드블록 금지. 반드시 JSON 한 개만 반환한다.
```

- [ ] **Step 2: 커밋**

```bash
cd ~/Documents/Claude
git add scripts/jira-dashboard/prompts/plan-writer.md
git commit -m "$(cat <<'EOF'
feat(jira-dashboard): 플랜 작성용 Claude 프롬프트 템플릿

- 이슈 JSON → 영향 subproject 판별 → Write로 plans/ 생성
- Frontmatter 필수 필드, 본문 구조, 결과 JSON 스키마 명시

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: poll-jira 오케스트레이터

**Files:**
- Create: `~/Documents/Claude/scripts/jira-dashboard/poll-jira.ts`

- [ ] **Step 1: poll-jira.ts 작성**

```typescript
// poll-jira.ts
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { homedir } from 'node:os';
import { Glob } from 'node:fs';
import { glob as nodeGlob } from 'node:fs/promises';

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
  findDriveFile,
} from './lib/drive-sync.ts';
import { sendTelegram } from './lib/telegram.ts';
import { createLogger } from './lib/logger.ts';
import { acquire, LockError } from './lib/lockfile.ts';
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

async function existingPlanKeys(board: BoardConfig): Promise<Set<string>> {
  const keys = new Set<string>();
  for (const sp of board.subprojects) {
    const plansDir = join(board.parent_workspace, sp.path, 'plans');
    if (!existsSync(plansDir)) continue;
    const iter = nodeGlob('**/*.md', { cwd: plansDir }) as AsyncIterable<string>;
    for await (const entry of iter) {
      const full = join(plansDir, entry);
      try {
        const text = readFileSync(full, 'utf8');
        const { data } = parseFrontmatter(text);
        keys.add(data.jira);
      } catch {
        // frontmatter 파싱 실패 시 파일명에서라도 키 추출
        const m = entry.match(/^([A-Z]+-\d+)/);
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
  cfg: RootConfig,
  board: BoardConfig,
  issue: JiraIssue,
): Promise<WriterResult> {
  const template = readFileSync(PROMPT_PATH, 'utf8');
  const prompt = template
    .replace('{{ISSUE_JSON}}', JSON.stringify(issue, null, 2))
    .replace('{{PARENT_WORKSPACE}}', board.parent_workspace)
    .replace('{{SUBPROJECTS_JSON}}', JSON.stringify(board.subprojects, null, 2));

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

    const boardsToRun = flags.board
      ? { [flags.board]: cfg.boards[flags.board] }
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
```

- [ ] **Step 2: 타입 체크**

Run: `cd ~/Documents/Claude/scripts/jira-dashboard && npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
cd ~/Documents/Claude
git add scripts/jira-dashboard/poll-jira.ts
git commit -m "$(cat <<'EOF'
feat(jira-dashboard): 09:00 poll 오케스트레이터

- 보드별 JQL 조회 → 중복 제외 → plan-writer 호출 → Drive 복사 → dashboard.json 갱신 → Telegram 요약 알림
- --dry-run, --board, --issue 플래그
- lockfile, 부분 실패 격리 처리

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: sync-drive 모듈 (standalone)

**Files:**
- Create: `~/Documents/Claude/scripts/jira-dashboard/sync-drive.ts`

- [ ] **Step 1: sync-drive.ts 작성**

```typescript
// sync-drive.ts
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { loadConfig } from './lib/config.ts';
import { queryJira, buildAllIssuesJql } from './lib/jira-client.ts';
import {
  buildDrivePath,
  findDriveFile,
  moveDriveFile,
  STATE_FOLDERS,
} from './lib/drive-sync.ts';
import { normalizeCategory, detectCancelledByDeletion } from './lib/normalize.ts';
import { loadState, saveState, upsertIssue } from './lib/dashboard-state.ts';
import { createLogger } from './lib/logger.ts';
import type { BoardConfig, RootConfig } from './types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function syncBoard(
  cfg: RootConfig,
  boardKey: string,
  board: BoardConfig,
  log = createLogger('sync'),
): Promise<void> {
  log.info(`[${boardKey}] sync 시작`);
  const jql = buildAllIssuesJql(board.project_key, cfg.jira.assignee_account_id);
  const remote = await queryJira(jql);
  const remoteKeys = new Set(remote.map(i => i.key));

  const state = loadState();

  // 원격에 있는 이슈: 정규화 → 필요 시 Drive 파일 이동
  for (const issue of remote) {
    const target = normalizeCategory(issue, board, cfg.defaults);
    const found = findDriveFile(cfg.google_drive_root, board.drive_folder, issue.key);
    if (!found) continue; // 플랜 없는 이슈는 여기서 처리 X (09:00 poll 담당)
    if (found.state !== target) {
      const toAbs = buildDrivePath(
        cfg.google_drive_root, board.drive_folder,
        found.subproject, target, found.filename,
      );
      moveDriveFile(found.absolutePath, toAbs);
      log.info(`[${boardKey}] ${issue.key}: ${found.state} → ${target} 이동`);
      // dashboard.json 갱신
      const existing = state.issues.find(i => i.key === issue.key);
      if (existing) {
        existing.status_raw = issue.status.name;
        existing.status_category = issue.status.statusCategory.key;
        existing.status_normalized = target;
        for (const p of existing.plans) {
          if (p.subproject === found.subproject) p.drive_path = toAbs;
        }
      }
    }
  }

  // 로컬(dashboard.json 기준)에는 있는데 원격에 없는 이슈 → cancelled 이동
  const localKeysForBoard = new Set(
    state.issues.filter(i => i.board === boardKey).map(i => i.key),
  );
  const cancelled = detectCancelledByDeletion(localKeysForBoard, remoteKeys);
  for (const key of cancelled) {
    const found = findDriveFile(cfg.google_drive_root, board.drive_folder, key);
    if (!found) continue;
    if (found.state === 'cancelled') continue;
    const toAbs = buildDrivePath(
      cfg.google_drive_root, board.drive_folder,
      found.subproject, 'cancelled', found.filename,
    );
    moveDriveFile(found.absolutePath, toAbs);
    log.info(`[${boardKey}] ${key}: 삭제됨 → cancelled 이동`);
    const existing = state.issues.find(i => i.key === key);
    if (existing) {
      existing.status_normalized = 'cancelled';
      for (const p of existing.plans) {
        if (p.subproject === found.subproject) p.drive_path = toAbs;
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

// standalone 실행 감지 (import.meta.url === file:// ...)
const invoked = process.argv[1] && fileURLToPath(import.meta.url) === join(process.cwd(), process.argv[1]).replace(process.cwd() + '/', process.cwd() + '/');
if (process.argv[1] && process.argv[1].endsWith('sync-drive.ts')) {
  main();
}
```

- [ ] **Step 2: 타입 체크**

Run: `cd ~/Documents/Claude/scripts/jira-dashboard && npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
cd ~/Documents/Claude
git add scripts/jira-dashboard/sync-drive.ts
git commit -m "$(cat <<'EOF'
feat(jira-dashboard): Jira 상태 → Drive 폴더 동기화

- 원격 상태로 normalize → 필요 시 Drive 파일 이동
- 원격에 없는 로컬 플랜 → cancelled 이동
- syncBoard export: poll/remind에서도 재사용 가능

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: remind-stale 모듈

**Files:**
- Create: `~/Documents/Claude/scripts/jira-dashboard/remind-stale.ts`

- [ ] **Step 1: remind-stale.ts 작성**

```typescript
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

      const lines = byBoard.get(issue.board) ?? [];
      const board = cfg.boards[issue.board];
      const sess = board?.session ?? issue.board;
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
```

- [ ] **Step 2: 타입 체크**

Run: `cd ~/Documents/Claude/scripts/jira-dashboard && npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
cd ~/Documents/Claude
git add scripts/jira-dashboard/remind-stale.ts
git commit -m "$(cat <<'EOF'
feat(jira-dashboard): 10:00 미착수 리마인드

- sync-drive 선행 실행으로 최신 상태 반영
- 조건: pending + 24h 경과 + 오늘 미전송
- last_reminded_at 기록 (같은 날 재전송 방지)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: (제거됨)

기존 팀 관행상 `plans/` 폴더는 git 에 커밋하여 기록으로 남긴다. 따라서 subproject `.gitignore` 에 `plans/` 를 추가하지 않는다. 자동화는 파일만 생성하고 커밋하지 않으며, 사용자가 feature 작업 시 수동으로 커밋한다.

---

## Task 18: CLAUDE.md 업데이트 (CeoReport, Metlife)

**Files (Modify):**
- `~/Documents/Insudeal/CeoReport/CLAUDE.md`
- `~/Documents/Insudeal/Metlife/CLAUDE.md`

- [ ] **Step 1: 두 파일에 동일 블록을 말미에 추가**

추가할 블록:
```markdown

# Jira 플랜 자동 실행 규칙

## 플랜 파일
- 위치: `<subproject>/plans/<JIRA_KEY>-<slug>.md`
- `plans/` 는 팀 리포에 커밋되는 기록물 (gitignore 아님). 자동화는 파일 생성만, 커밋은 사용자가 수동
- Frontmatter 필수 필드: `jira`, `title`, `area`, `subproject`, `related`, `suggested_branch`, `jira_url`, `created`

## 트리거 메시지 (자연어)
다음 패턴 감지 시 자동 처리:
- `<JIRA_KEY> 진행해` / `<JIRA_KEY> 실행` / `<JIRA_KEY> 시작` → 플랜 실행
- `<JIRA_KEY> 수정해 <변경사항>` → 플랜 Edit + Google Drive 복사본 갱신
- `<JIRA_KEY> 보류` → Jira 상태를 "보류/Won't Do" 전환
- JIRA_KEY 미지정 시 pending 플랜 목록 제시

## 실행 시 동작
1. `Glob plans/<JIRA_KEY>-*.md` 로 파일 탐색 (cwd = 현재 subproject)
2. `Read` + frontmatter 파싱
3. `related:` 필드에 값이 있으면 "다른 영역(X) 플랜도 있습니다" 안내
4. `mcp__jira__jira_transition_issue` 로 Jira 상태를 "진행 중" 전환
5. `suggested_branch` 값으로 git 브랜치 생성 여부 사용자 확인 (자동 생성 금지)
6. `superpowers:executing-plans` 스킬 호출해 구현 시작
7. 완료 시 "Jira 상태를 완료로 전환할까요?" 확인 후 전환

## 작업 영역 결정
- 현재 cwd 기준 subproject 자동 결정
- cwd가 parent_workspace면 "어느 하위 프로젝트에서 시작?" 사용자 확인
- 양쪽 영역 플랜 있으면 "backend 먼저, API 확정 후 frontend" 순서 제안

## 플랜 수정 시 동작
- `Edit` 로 원본 파일 수정
- Drive에서 해당 파일 현재 위치 탐색 (`Glob` 으로 `.../플랜/<drive_folder>/**/<JIRA_KEY>-*.md`)
- 찾은 폴더에 그대로 덮어쓰기 (상태 폴더 이동하지 않음)
- 수정 이력은 별도 기록 안 함 (Google Drive 버전 히스토리 활용)
- 완료 후 텔레그램에 `"✏️ <JIRA_KEY> 플랜 수정됨"` 짧은 알림
```

- [ ] **Step 2: 편집 명령 실행**

```bash
BLOCK='
# Jira 플랜 자동 실행 규칙

## 플랜 파일
- 위치: `<subproject>/plans/<JIRA_KEY>-<slug>.md`
- `plans/` 는 팀 리포에 커밋되는 기록물 (gitignore 아님). 자동화는 파일 생성만, 커밋은 사용자가 수동
- Frontmatter 필수 필드: `jira`, `title`, `area`, `subproject`, `related`, `suggested_branch`, `jira_url`, `created`

## 트리거 메시지 (자연어)
다음 패턴 감지 시 자동 처리:
- `<JIRA_KEY> 진행해` / `<JIRA_KEY> 실행` / `<JIRA_KEY> 시작` → 플랜 실행
- `<JIRA_KEY> 수정해 <변경사항>` → 플랜 Edit + Google Drive 복사본 갱신
- `<JIRA_KEY> 보류` → Jira 상태를 "보류/Won'\''t Do" 전환
- JIRA_KEY 미지정 시 pending 플랜 목록 제시

## 실행 시 동작
1. `Glob plans/<JIRA_KEY>-*.md` 로 파일 탐색 (cwd = 현재 subproject)
2. `Read` + frontmatter 파싱
3. `related:` 필드에 값이 있으면 "다른 영역(X) 플랜도 있습니다" 안내
4. `mcp__jira__jira_transition_issue` 로 Jira 상태를 "진행 중" 전환
5. `suggested_branch` 값으로 git 브랜치 생성 여부 사용자 확인 (자동 생성 금지)
6. `superpowers:executing-plans` 스킬 호출해 구현 시작
7. 완료 시 "Jira 상태를 완료로 전환할까요?" 확인 후 전환

## 작업 영역 결정
- 현재 cwd 기준 subproject 자동 결정
- cwd가 parent_workspace면 "어느 하위 프로젝트에서 시작?" 사용자 확인
- 양쪽 영역 플랜 있으면 "backend 먼저, API 확정 후 frontend" 순서 제안

## 플랜 수정 시 동작
- `Edit` 로 원본 파일 수정
- Drive에서 해당 파일 현재 위치 탐색 (`Glob` 으로 `.../플랜/<drive_folder>/**/<JIRA_KEY>-*.md`)
- 찾은 폴더에 그대로 덮어쓰기 (상태 폴더 이동하지 않음)
- 수정 이력은 별도 기록 안 함 (Google Drive 버전 히스토리 활용)
- 완료 후 텔레그램에 `"✏️ <JIRA_KEY> 플랜 수정됨"` 짧은 알림
'

for f in ~/Documents/Insudeal/CeoReport/CLAUDE.md ~/Documents/Insudeal/Metlife/CLAUDE.md; do
  if ! grep -q "Jira 플랜 자동 실행 규칙" "$f"; then
    printf '%s' "$BLOCK" >> "$f"
    echo "updated: $f"
  else
    echo "skip (already has block): $f"
  fi
done
```

Expected: 두 파일 모두 updated 또는 skip.

- [ ] **Step 3: 각 리포에서 커밋**

```bash
for d in ~/Documents/Insudeal/CeoReport ~/Documents/Insudeal/Metlife; do
  cd "$d" || continue
  if ! git diff --quiet CLAUDE.md 2>/dev/null; then
    git add CLAUDE.md
    git commit -m "docs: add Jira 플랜 자동 실행 규칙 블록"
    echo "committed: $d"
  fi
done
```

Expected: 각 리포에서 커밋 성공 로그.

- [ ] **Step 4: push 여부는 사용자 판단**

---

## Task 19: launcher 스크립트 + launchd plist

**Files:**
- Create: `~/.local/bin/jira-dashboard-poll.sh`
- Create: `~/.local/bin/jira-dashboard-remind.sh`
- Create: `~/Library/LaunchAgents/com.pakjungeol.jira-dashboard-poll.plist`
- Create: `~/Library/LaunchAgents/com.pakjungeol.jira-dashboard-remind.plist`

- [ ] **Step 1: launcher 스크립트 생성**

```bash
mkdir -p ~/.local/bin ~/.local/logs
cat > ~/.local/bin/jira-dashboard-poll.sh <<'SH'
#!/bin/bash
set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$HOME/.claude/bin:$HOME/.local/bin:$PATH"
cd "$HOME/Documents/Claude/scripts/jira-dashboard" || exit 1
exec /opt/homebrew/bin/npx tsx poll-jira.ts
SH
chmod +x ~/.local/bin/jira-dashboard-poll.sh

cat > ~/.local/bin/jira-dashboard-remind.sh <<'SH'
#!/bin/bash
set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$HOME/.claude/bin:$HOME/.local/bin:$PATH"
cd "$HOME/Documents/Claude/scripts/jira-dashboard" || exit 1
exec /opt/homebrew/bin/npx tsx remind-stale.ts
SH
chmod +x ~/.local/bin/jira-dashboard-remind.sh

ls -l ~/.local/bin/jira-dashboard-*.sh
```

Expected: 실행 가능한 두 파일 (`-rwxr-xr-x`).

- [ ] **Step 2: poll plist 생성**

```bash
cat > ~/Library/LaunchAgents/com.pakjungeol.jira-dashboard-poll.plist <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.pakjungeol.jira-dashboard-poll</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>/Users/pakjungeol/.local/bin/jira-dashboard-poll.sh</string>
    </array>

    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>9</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>

    <key>StandardOutPath</key>
    <string>/Users/pakjungeol/.local/logs/jira-dashboard-poll-stdout.log</string>

    <key>StandardErrorPath</key>
    <string>/Users/pakjungeol/.local/logs/jira-dashboard-poll-stderr.log</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/Users/pakjungeol/.claude/bin:/Users/pakjungeol/.local/bin</string>
        <key>HOME</key>
        <string>/Users/pakjungeol</string>
    </dict>
</dict>
</plist>
XML
echo "created poll plist"
```

- [ ] **Step 3: remind plist 생성**

```bash
cat > ~/Library/LaunchAgents/com.pakjungeol.jira-dashboard-remind.plist <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.pakjungeol.jira-dashboard-remind</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>/Users/pakjungeol/.local/bin/jira-dashboard-remind.sh</string>
    </array>

    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>10</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>

    <key>StandardOutPath</key>
    <string>/Users/pakjungeol/.local/logs/jira-dashboard-remind-stdout.log</string>

    <key>StandardErrorPath</key>
    <string>/Users/pakjungeol/.local/logs/jira-dashboard-remind-stderr.log</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/Users/pakjungeol/.claude/bin:/Users/pakjungeol/.local/bin</string>
        <key>HOME</key>
        <string>/Users/pakjungeol</string>
    </dict>
</dict>
</plist>
XML
echo "created remind plist"
```

- [ ] **Step 4: launchd 등록 및 상태 확인**

```bash
launchctl unload ~/Library/LaunchAgents/com.pakjungeol.jira-dashboard-poll.plist 2>/dev/null || true
launchctl unload ~/Library/LaunchAgents/com.pakjungeol.jira-dashboard-remind.plist 2>/dev/null || true
launchctl load -w ~/Library/LaunchAgents/com.pakjungeol.jira-dashboard-poll.plist
launchctl load -w ~/Library/LaunchAgents/com.pakjungeol.jira-dashboard-remind.plist
launchctl list | grep jira-dashboard
```

Expected: 두 Label이 `launchctl list` 에 출력됨 (PID 0 또는 - 표시 정상).

---

## Task 20: 통합 검증 (--dry-run → 실제 실행)

- [ ] **Step 1: 타입 체크 및 테스트 전체 실행**

Run:
```bash
cd ~/Documents/Claude/scripts/jira-dashboard
npx tsc --noEmit && npx vitest run
```
Expected: 타입 에러 0, 모든 unit test PASS.

- [ ] **Step 2: --dry-run 으로 CEOR 한 보드만 시험**

Run:
```bash
cd ~/Documents/Claude/scripts/jira-dashboard
npx tsx poll-jira.ts --dry-run --board CEOR
```
Expected:
- 로그에 `[CEOR] N건 조회` 출력
- 파일 생성 없음 (dry-run)
- 텔레그램에 `🧪 [DRY-RUN] 오늘의 신규 플랜 ...` 수신

- [ ] **Step 3: 실제 1건 강제 실행 (가장 우선순위 낮은 이슈 하나 선택)**

Run:
```bash
cd ~/Documents/Claude/scripts/jira-dashboard
# 먼저 후보 확인
npx tsx -e "
import { loadConfig } from './lib/config.ts';
import { queryJira, buildAssignedActiveJql } from './lib/jira-client.ts';
const cfg = loadConfig();
const jql = buildAssignedActiveJql('CEOR', cfg.jira.assignee_account_id);
const issues = await queryJira(jql);
console.log(issues.map(i => \`\${i.key}: \${i.title}\`).join('\n'));
"
```
출력 중 하나 선택 (예: `JIRA-CEOR-N`).

```bash
npx tsx poll-jira.ts --board CEOR --issue JIRA-CEOR-N
```
Expected:
- `ceo-report-backend/plans/` 또는 `ceo-report-frontend/plans/` 에 플랜 파일 생성
- Google Drive `플랜/ceo/.../pending/` 에 동일 파일 존재
- dashboard.json 에 엔트리 추가
- 텔레그램에 `🆕 오늘의 신규 플랜 ...` 수신

검증 명령:
```bash
ls ~/Documents/Insudeal/CeoReport/ceo-report-backend/plans/ 2>/dev/null
ls ~/Documents/Insudeal/CeoReport/ceo-report-frontend/plans/ 2>/dev/null
ls "/Users/pakjungeol/Library/CloudStorage/GoogleDrive-leaf9016@gmail.com/내 드라이브/Insudeal/플랜/ceo"/*/pending/ 2>/dev/null
cat ~/Documents/Claude/scripts/jira-dashboard/state/dashboard.json | head -40
```

- [ ] **Step 4: sync-drive 수동 실행 (상태 이동 시험)**

Jira 웹에서 방금 플랜 생성한 이슈의 상태를 `해야 할 일` → `진행 중` 으로 바꾼 뒤:

```bash
cd ~/Documents/Claude/scripts/jira-dashboard
npx tsx sync-drive.ts
```
Expected: Drive 에서 해당 파일이 `pending/` → `active/` 로 이동됨.

- [ ] **Step 5: remind-stale 수동 실행 시험**

dashboard.json 의 해당 엔트리에서 `plan_created_at` 을 어제 날짜로 편집한 뒤 (수동):

```bash
cd ~/Documents/Claude/scripts/jira-dashboard
npx tsx remind-stale.ts
```
Expected: 상태가 pending일 때만 텔레그램 리마인드 수신. active로 바꿨으면 알림 없음.

확인 후 `plan_created_at` 원상 복구 또는 dashboard.json 을 삭제하여 초기화 가능 (다음 실행에서 자동 재생성됨).

- [ ] **Step 6: 운영 지표 커밋 (plans/ 폴더 변경은 이미 ignore됨)**

```bash
cd ~/Documents/Claude
# launcher/plist/문서 변경 누락 없는지 확인
git status
```
이 단계에서 추가 커밋이 필요하면 개별 커밋으로 정리 (launcher 스크립트와 plist는 Claude 환경 레포 범위에 있는지 사용자 판단에 따라 포함 또는 미포함).

- [ ] **Step 7: 운영 전환 체크리스트**

E2E 시나리오 (스펙 섹션 15-E2E 기준, 한 번씩 수동 재현):

- [ ] 새 이슈 생성 → 09:00 폴링 (또는 수동 실행) → 플랜 생성 → 텔레그램 알림
- [ ] 동일 이슈 다음날 재폴링 → skip (중복 방지)
- [ ] 상태 "진행 중" 변경 → Drive 파일이 `active/` 로 이동
- [ ] 플랜 작성 후 24h 경과 + 상태 pending → 10:00 리마인드 1회
- [ ] Jira 에서 이슈 삭제 → 다음 sync 에서 `cancelled/` 이동
- [ ] UT "비스포크 보류" 상태 → `cancelled/` 분류 (수동 테스트는 실제 UT 이슈 필요)
- [ ] 백엔드+프론트 둘 다 영향 이슈 → 양쪽 `plans/` 에 파일 + related 상호 참조
- [ ] `"JIRA-CEOR-<N> 수정해 X 추가"` → Edit + Drive 복사본 갱신 (세션 Claude)
- [ ] 세션 내 `"진행해"` → Jira 상태 전환 + executing-plans 호출 (세션 Claude)

세션 측 3개는 실제 ceo/metlife tmux 세션에서 Claude에게 직접 지시하여 확인. 이 3개가 작동하지 않으면 CLAUDE.md 블록(Task 18)이 제대로 반영됐는지 점검.

- [ ] **Step 8: 첫 주 DEBUG 모드 유지 옵션**

필요 시 `lib/telegram.ts` 의 `sendTelegram` 호출부에 한시적으로 `[DEBUG]` prefix 를 붙이는 래퍼를 추가한다. 1주 안정화 후 제거.

---

## Self-Review

### Spec coverage

| 스펙 섹션 | 구현 Task |
|-----------|-----------|
| 3. 아키텍처 | Task 1 (스캐폴딩) + 전체 구조 |
| 4. boards.yaml | 이미 작성 완료 (브레인스토밍에서) |
| 5. 정규화 로직 | Task 4 (normalize.ts) |
| 6. 플랜 파일 규격 | Task 5 (frontmatter) + Task 13 (plan-writer 프롬프트) |
| 7. Google Drive 구조 | Task 10 (drive-sync) |
| 8. 09:00 폴링 | Task 14 (poll-jira.ts) |
| 9. 10:00 리마인드 | Task 16 (remind-stale.ts) |
| 10. 사용자 상호작용 | Task 18 (CLAUDE.md 규칙) |
| 11. dashboard.json | Task 2 (타입) + Task 9 (state 모듈) |
| 12. launchd 등록 | Task 19 (plist + launcher) |
| 13. 에러 처리 | Task 14/15/16 finally + try/catch, Task 7 lockfile |
| 14. 로깅 | Task 6 (logger) |
| 15. 테스트 전략 | Task 3/4/5/10 (Vitest), Task 20 (--dry-run 통합 검증) |
| 16. Phase 2 훅 | Task 4 (normalize.ts 독립) + Task 9 (dashboard.json) |
| 17. 구현 순서 | Task 1-20 이 스펙의 순서와 정렬됨 |

### 타입 일관성 체크
- `Category` (4분류): normalize.ts, drive-sync.ts, dashboard-state.ts 에서 동일 타입 import 사용.
- `JiraIssue`: jira-client.ts 반환 타입, normalize.ts 인자 타입, poll-jira.ts 전달 타입 일치.
- `PlanFrontmatter`: frontmatter.ts 파싱/생성 스키마와 plan-writer 프롬프트 출력 스펙 일치.
- Drive 경로 함수명(`buildDrivePath`, `findDriveFile`, `moveDriveFile`, `copyToDrive`, `ensureDriveFolders`) 은 poll/sync 에서 동일 네이밍으로 호출.

### Placeholder 점검
- "TBD" / "TODO" 없음.
- 모든 코드 블록은 실행 가능한 완전한 코드.
- 프롬프트 템플릿은 `{{ISSUE_JSON}}`, `{{JQL}}`, `{{SUBPROJECTS_JSON}}`, `{{PARENT_WORKSPACE}}` 4개 치환자만 사용하며 모두 코드에서 채운다.

### 알려진 보강 여지 (Phase 2 또는 필요 시)
- Jira query 실패 시 재시도 로직은 단순 전체 중단. 향후 exponential backoff 재시도 도입 가능.
- 로그 30일 자동 정리 크론은 별도 운영 작업으로 유보.
- 플랜 수정 트리거의 세션 측 구현은 본 플랜에 포함되지 않음 (CLAUDE.md 규칙으로 지시만). 실제 수정 흐름은 세션 Claude 가 CLAUDE.md 를 읽고 자연스럽게 수행.
