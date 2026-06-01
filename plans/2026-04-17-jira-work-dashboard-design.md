# Jira Work Dashboard 설계

**작성일**: 2026-04-17
**저자**: Tej (leaf9016@gmail.com)
**상태**: 설계 확정, 구현 플랜 대기

## 1. 배경과 목표

Jira에 배정되는 업무를 매일 아침 자동으로 수집해 각 프로젝트별 플랜으로 생성하고, 구현은 Claude가, 검증은 사용자와 Claude가 함께, 상태 관리는 Jira를 단일 진실의 원천(SoT)으로 하는 **개인 업무 대시보드**.

### 목표
- 매일 09:00 Jira 폴링 → 신규 이슈(나한테 배정, 아직 완료 안 됨)에 대해 플랜 파일 자동 생성
- 각 프로젝트의 백엔드/프론트엔드 등 하위 구조를 인식해 올바른 폴더에 플랜 배치
- 플랜 상태(대기/진행/완료/취소)를 Jira 상태 기반으로 자동 관리
- 미착수 플랜은 다음날 10:00 텔레그램 리마인드
- 플랜은 사용자 자연어 요청으로 수정 가능
- Phase 2에서 로컬 웹 대시보드로 확장 가능한 기반 마련

### 비목표 (out of scope)
- Phase 1에서 웹 UI 제작 (Phase 2로 유보)
- Jira가 아닌 경로(개인톡 등)로 들어오는 업무 지시 처리 (향후 검토)
- 팀원 공유용 대시보드 (개인 도구)
- 구현/검증 자동화 (기존 Claude Code 워크플로우 활용)

## 2. 용어

| 용어 | 정의 |
|------|------|
| **보드(board)** | Jira 프로젝트 + 해당 보드 ID (예: CEOR/14, UT/13) |
| **subproject** | 하위 git 리포지토리 (예: ceo-report-backend, metlife-noble-rich) |
| **플랜(plan)** | `plans/<JIRA_KEY>-<slug>.md` 파일 |
| **4분류(category)** | pending / active / done / cancelled (우리 대시보드의 캐노니컬 상태) |
| **세션** | tmux 창 이름 (ceo, metlife) — ccbot Telegram 토픽과 1:1 매핑 |
| **headless Claude** | `claude -p` 로 tmux 밖에서 실행되는 Claude CLI 프로세스 |

## 3. 아키텍처

```
                    ┌──────────────────────────────────┐
                    │     launchd (macOS scheduler)    │
                    │   09:00 poll  │  10:00 remind    │
                    └───────┬──────────────┬───────────┘
                            │              │
                  ┌─────────▼───┐   ┌──────▼────────┐
                  │ poll-jira   │   │ remind-stale  │
                  │    .ts      │   │     .ts       │
                  └──────┬──────┘   └──────┬────────┘
                         │                 │
          ┌──────────────┼─────────────────┼──────────────┐
          ▼              ▼                 ▼              ▼
    ┌──────────┐  ┌──────────────┐   ┌──────────┐  ┌─────────────┐
    │ Jira MCP │  │ Headless     │   │ Google   │  │  Telegram   │
    │ (via     │  │ Claude CLI   │   │  Drive   │  │     Bot     │
    │ claude-p)│  │ (plan 작성)  │   │ (4분류)  │  │   (알림)    │
    └──────────┘  └──────────────┘   └──────────┘  └─────────────┘
                         │
                         ▼
                  ┌──────────────┐
                  │각 subproject │  ← plans/JIRA-<KEY>-<slug>.md
                  │   /plans/    │    (git 추적, 기록용)
                  └──────────────┘
```

### 실행 주체 분리
- **배치(09:00, 10:00)**: launchd → Node/TS 스크립트 → headless `claude -p` 가 각 subproject cwd로 실행
- **사용자 상호작용**: 기존 ccbot + tmux 흐름 그대로 활용 (별도 UI 없음)

### 언어
- **Node/TypeScript** 로 통일. 기존 `naver-blog-post.js` 와 일관. 설정 파일(`boards.yaml`) 타입 안정성 확보.

### 코드 배치

```
~/Documents/Claude/scripts/jira-dashboard/
├── boards.yaml          # 설정 (작성 완료)
├── poll-jira.ts         # 09:00 메인 오케스트레이터
├── remind-stale.ts      # 10:00 리마인드
├── sync-drive.ts        # Jira 상태 → Drive 폴더 동기화
├── lib/
│   ├── normalize.ts     # Jira 상태 → 4분류 (Phase 2 재사용)
│   ├── jira-client.ts   # Jira MCP 래퍼
│   ├── drive-sync.ts    # Google Drive 파일 I/O
│   ├── claude-runner.ts # headless claude -p 실행
│   └── telegram.ts      # 알림
├── state/
│   └── dashboard.json   # 최신 정규화 스냅샷 (Phase 2 데이터 소스)
├── package.json
└── tsconfig.json
```

## 4. 설정 — `boards.yaml`

**위치**: `~/Documents/Claude/scripts/jira-dashboard/boards.yaml` (작성 완료)

### 핵심 설계
- Jira statusCategory(new/indeterminate/done)를 기본 매핑으로 사용 → 프로젝트마다 상태 이름이 달라도 자동 분류
- `name_overrides` 로 특정 이름만 예외 처리 (예: UT의 "비스포크 보류" → cancelled)
- `cancelled_detection` 으로 삭제(A) + Resolution 필드(B) 감지

### 보드 설정 요약

| 보드 | 세션 | Subprojects | 특수 상태 |
|------|------|-------------|-----------|
| CEOR (board 14) | ceo | ceo-report-backend, ceo-report-frontend | cancelled 없음 → 삭제 감지 활용 |
| UT (board 13) | metlife | insudeal-x-backend, metlife-noble-rich, metlife-simple-financial-calculator | "비스포크 보류" → cancelled override |

## 5. 상태 정규화 로직 (`lib/normalize.ts`)

```typescript
function normalize(issue: JiraIssue, boardConfig: BoardConfig): Category {
  // 1순위: 이름 override
  const override = boardConfig.name_overrides[issue.status.name];
  if (override) return override;

  // 2순위: Resolution 필드 (cancelled)
  if (issue.resolution && CANCELLED_RESOLUTIONS.includes(issue.resolution.name)) {
    return 'cancelled';
  }

  // 3순위: statusCategory 기본 매핑
  return defaultCategoryMap[issue.status.statusCategory.key];
  // new → pending, indeterminate → active, done → done
}

// 삭제된 이슈 감지
function detectCancelledByDeletion(
  localPlans: Set<string>,  // plans/ 에 있는 Jira 키
  remoteIssues: Set<string> // Jira에 실제 존재하는 키
): string[] {
  return [...localPlans].filter(k => !remoteIssues.has(k));
}
```

## 6. 플랜 파일 규격

### 경로
```
<subproject_root>/plans/<JIRA_KEY>-<slug>.md
```
- `plans/` 는 **팀 리포에 커밋되어 기록으로 남김** (gitignore 대상 아님). 자동화는 파일만 생성하고 커밋하지 않으며, 사용자가 작업 시작 시 feature 커밋에 포함하거나 별도로 커밋.
- Google Drive 백업만 상태 폴더로 이동, 원본 위치는 고정

### 프론트매터 스키마

```yaml
---
jira: JIRA-CEOR-123
title: "고객사 리포트 API 추가"
area: backend                     # backend | frontend | noble-rich | simple-calc | insudeal-x-backend
subproject: ceo-report-backend
related:                          # 같은 이슈의 다른 영역 플랜 (있는 경우만)
  - ../ceo-report-frontend/plans/JIRA-CEOR-123-customer-report.md
suggested_branch: feat/CEOR-123-customer-report-api
jira_url: https://insudeal.atlassian.net/browse/JIRA-CEOR-123
created: 2026-04-17T09:00:00+09:00
---

# JIRA-CEOR-123: 고객사 리포트 API 추가

(Claude가 작성한 플랜 본문)
```

### 영역 판별 (Component/Label 없이)
- Claude가 플랜 작성 시점에 양쪽 코드베이스 탐색(`Glob`, `Read CLAUDE.md`)
- 각 subproject `description` 참고
- 영향 받는 subproject 1~N개 자동 판별
- **양쪽 영역이면 양쪽 `plans/` 에 각각 파일 생성** 후 `related:` 로 상호 참조

## 7. Google Drive 구조

**루트**: `/Users/pakjungeol/Library/CloudStorage/GoogleDrive-leaf9016@gmail.com/내 드라이브/Insudeal/플랜/`

```
플랜/
├── ceo/
│   ├── backend/
│   │   ├── pending/    JIRA-CEOR-123-xxx.md
│   │   ├── active/
│   │   ├── done/
│   │   └── cancelled/
│   └── frontend/
│       └── pending/    JIRA-CEOR-123-xxx.md  # 같은 이슈 다른 파일
└── metlife/
    ├── backend/         # insudeal-x-backend
    ├── noble-rich/
    └── simple-calc/
```

동기화 규칙:
- 원본(`<subproject>/plans/`)은 **고정**, 건드리지 않음
- Drive 복사본만 Jira 상태에 따라 4분류 폴더 사이 이동
- 플랜 수정 시 원본 Edit 후 Drive 복사본 덮어쓰기 (버전 히스토리는 Google Drive가 자동 관리)

## 8. 09:00 폴링 플로우 (`poll-jira.ts`)

```
1. boards.yaml 로드
2. 각 보드에 대해 Jira JQL 조회:
     assignee = currentUser()
     AND statusCategory in (new, indeterminate)
3. 각 이슈에 대해:
   a. 중복 체크: 모든 subproject에서 plans/<KEY>-*.md glob
      → 이미 있으면 skip
   b. headless `claude -p` 호출 (cwd = parent_workspace):
        권한: Read, Glob, Grep, Write, Bash(git status), Task
        출력: 생성된 플랜 경로 배열 (JSON)
   c. Google Drive pending/ 폴더로 복사
   d. dashboard.json 에 엔트리 추가/갱신
   e. 텔레그램 알림 누적
4. sync-drive 호출 (기존 이슈들 상태 변경 반영)
5. 텔레그램에 신규 플랜 요약 1회 전송
```

### JQL 세부
```
project = CEOR AND assignee = currentUser()
  AND statusCategory in (new, indeterminate)
ORDER BY updated DESC
```
- `done` 제외 (완료된 건 플랜 새로 만들 필요 없음)
- `indeterminate` 포함 (이미 진행 중인 건도 플랜 없으면 만듦)

### headless Claude 프롬프트 스켈레톤 (개념)
```
[입력]
- Jira 이슈: { key, title, body, comments, labels, components }
- Subprojects 리스트: [{ key, path, description }, ...]

[지시]
1. 양쪽 subproject 코드베이스를 탐색하여 영향 분석
2. 영향 받는 subproject 1~N개 판별
3. 각 subproject의 plans/<KEY>-<slug>.md 생성
   - 프론트매터 포함
   - related: 필드에 다른 영역 플랜 경로 상호 참조
4. 결과 JSON 반환: [{subproject, path, area}]
```

### 텔레그램 알림 포맷
```
🆕 오늘의 신규 플랜 (2건)

[ceo]
• JIRA-CEOR-123: 고객사 리포트 API
  영역: backend, frontend (2파일)
  → "JIRA-CEOR-123 진행해" 로 시작

[metlife]
• UT-456: 가상설계 계산식 버그
  영역: noble-rich

조회: Drive/플랜/
```

## 9. 10:00 리마인드 플로우 (`remind-stale.ts`)

### 리마인드 조건 (모두 충족)
1. `plan_created_at` 이 24시간 이상 경과
2. Jira 상태가 여전히 `statusCategory = new` (pending 그대로)
3. 관련 플랜 파일이 여전히 존재

### 중복 알림 방지
- `dashboard.json` 의 이슈별 `last_reminded_at` 기록
- 같은 날(YYYY-MM-DD) 중복 전송 안 함
- 매일 반복: 상태 변경 안 하면 매일 알림 (상태 바꾸면 자동 꺼짐)

### 포맷
```
⏰ 미착수 플랜 리마인드

어제 생성됐지만 아직 시작 안 한 작업:

[ceo]
• JIRA-CEOR-123: 고객사 리포트 API
  → 생성: 어제 09:00 / 상태: 해야 할 일
  → 진행: "JIRA-CEOR-123 진행해"
  → 보류: "JIRA-CEOR-123 보류"

(상태가 진행중/완료로 바뀌면 리마인드 자동 중지)
```

## 10. 사용자 상호작용 (세션 측)

### 트리거 메시지
사용자가 tmux 세션 또는 ccbot Telegram 토픽에서 자연어로 명령:

| 메시지 | 세션 내 Claude 동작 |
|--------|---------------------|
| `<JIRA_KEY> 진행해` | plans/ 탐색 → Jira 상태 "진행 중" 전환 → executing-plans 스킬 |
| `<JIRA_KEY> 수정해 <변경내용>` | plans/ Edit → Drive 복사본 갱신 → 짧은 알림 |
| `<JIRA_KEY> 보류` | Jira 상태를 "보류/Won't Do" 전환 |
| `오늘 플랜 뭐 있어?` | pending 플랜 목록 제시 (JIRA 키 미지정 시) |

### CLAUDE.md 추가 블록 (각 프로젝트)

`~/Documents/Insudeal/CeoReport/CLAUDE.md`, `~/Documents/Insudeal/Metlife/CLAUDE.md` 양쪽에 동일 블록 추가:

```markdown
# Jira 플랜 자동 실행 규칙

## 플랜 파일
- 위치: `<subproject>/plans/<JIRA_KEY>-<slug>.md`
- 프론트매터: jira, area, related, suggested_branch, jira_url, created

## 트리거 감지
- `<JIRA_KEY> 진행해/실행/시작` → 실행
- `<JIRA_KEY> 수정해 ...` → Edit + Drive 동기화
- `<JIRA_KEY> 보류` → Jira 상태 전환

## 실행 시 동작
1. Glob plans/<JIRA_KEY>-*.md (cwd = 현재 subproject)
2. Read + 프론트매터 파싱
3. related: 있으면 "다른 영역 플랜도 있습니다" 알림
4. mcp__jira__jira_transition_issue 로 "진행 중" 전환
5. suggested_branch 로 git 브랜치 생성 여부 사용자 확인
6. superpowers:executing-plans 스킬 호출
7. 완료 시 "Jira 상태를 완료로 전환할까요?" 확인 후 전환

## 작업 영역 결정
- cwd 기준 subproject 자동 결정
- cwd가 parent_workspace면 "어느 하위 프로젝트?" 물어봄
- 양쪽 영역 플랜 있으면 "backend 먼저, API 확정 후 frontend" 순서 제안

## 플랜 수정 시
- Edit 도구로 원본 파일 수정
- Drive 에서 해당 파일 현재 위치 탐색 (`Glob Drive/플랜/**/JIRA-<KEY>-*.md`)
- 찾은 폴더에 그대로 덮어쓰기 (상태 폴더 이동 없음)
- 수정 이력은 별도 기록 안 함 (Google Drive 버전 히스토리 활용)
```

## 11. dashboard.json 스키마

Phase 2 웹 대시보드의 데이터 소스로 사용.

```json
{
  "generated_at": "2026-04-17T09:00:00+09:00",
  "issues": [
    {
      "key": "JIRA-CEOR-123",
      "title": "고객사 리포트 API 추가",
      "board": "CEOR",
      "status_raw": "해야 할 일",
      "status_category": "new",
      "status_normalized": "pending",
      "jira_url": "https://insudeal.atlassian.net/browse/JIRA-CEOR-123",
      "plans": [
        {
          "subproject": "ceo-report-backend",
          "area": "backend",
          "path": "plans/JIRA-CEOR-123-customer-report-api.md",
          "drive_path": "플랜/ceo/backend/pending/JIRA-CEOR-123-customer-report-api.md"
        }
      ],
      "plan_created_at": "2026-04-17T09:00:00+09:00",
      "last_reminded_at": null
    }
  ]
}
```

## 12. launchd 등록

```
~/Library/LaunchAgents/
├── com.tej.jira-dashboard-poll.plist      # 매일 09:00
└── com.tej.jira-dashboard-remind.plist    # 매일 10:00
```

**중요 제약** (메모리 `feedback_launchd_tcc` 준수):
- stdout/stderr 경로는 `~/Documents` **밖**에 두어야 TCC 이슈 없음
- 로그 위치: `~/Library/Logs/jira-dashboard/`
- `StartCalendarInterval` + `ThrottleInterval` 로 중복 발동 방지

## 13. 에러 처리

원칙: **부분 실패는 계속 진행, 치명적 실패는 즉시 알림**

| 시나리오 | 처리 |
|---------|------|
| Jira MCP 실패 (네트워크/인증) | 전체 중단 + 텔레그램 에러 + 로그 |
| 특정 이슈 플랜 생성 실패 | 해당 이슈만 skip, 실패 목록 요약 알림 |
| Drive 경로 없음 | `mkdir -p` 후 재시도 |
| Drive 동기화 지연 | 쓰기 후 5초 대기, 실패 시 다음 실행에서 복구 (idempotent) |
| headless claude 타임아웃 (5분) | 해당 이슈 skip |
| 프론트매터 파싱 실패 | 손상 플랜 로그 기록, dashboard.json 제외 |
| 중복 실행 | `~/Documents/Claude/logs/jira-dashboard.lock` 선점 |
| Jira rate limit | 기본 100ms sleep, 429 시 exponential backoff (1s, 2s, 4s, 최대 3회) |

## 14. 로깅

```
~/Library/Logs/jira-dashboard/
├── poll-YYYYMMDD.log       # 09:00 실행
├── remind-YYYYMMDD.log     # 10:00 실행
└── errors.log              # 치명 에러만 누적
```

포맷 예시:
```
[2026-04-17 09:00:01] INFO  poll: CEOR 이슈 5건 조회 완료
[2026-04-17 09:00:12] ERROR poll: JIRA-CEOR-124 플랜 생성 실패 (timeout)
```

- 30일 보관, 주간 크론으로 `find ... -mtime +30 -delete`

## 15. 테스트 전략

### 단위 테스트 (Vitest)
- `lib/normalize.ts` — 매핑 경계 케이스 (override 우선순위, resolution, 삭제 감지)
- `lib/drive-sync.ts` — 파일 이동 (mock fs)
- 프론트매터 파싱/생성

### 통합 테스트 (수동 CLI 플래그)
- `--dry-run`: Jira 조회는 실제, 파일 쓰기·텔레그램 skip
- `--board CEOR`: 한 보드만
- `--issue JIRA-CEOR-123`: 특정 이슈 강제 (중복 무시)

### 운영 검증
- 첫 주: 텔레그램 알림 맨 아래 `[DEBUG]` 표시, 수동 `--dry-run` 병행
- 1주 안정화 후 `[DEBUG]` 제거

### E2E 시나리오 체크리스트
1. [ ] 새 이슈 생성 → 09:00 폴링 → 플랜 생성 → 텔레그램 알림
2. [ ] 동일 이슈 다음날 재폴링 → skip (중복 방지)
3. [ ] 이슈 상태 "진행 중" 변경 → Drive 파일이 `active/`로 이동
4. [ ] 플랜 작성 후 24h 경과 + 상태 pending → 10:00 리마인드 1회
5. [ ] Jira에서 이슈 삭제 → 다음 sync에서 `cancelled/` 이동
6. [ ] UT "비스포크 보류" → `cancelled/` 분류
7. [ ] 백엔드+프론트 둘 다 영향 있는 이슈 → 양쪽 plans/ 에 파일 + related 상호 참조
8. [ ] `"JIRA-CEOR-123 수정해 X 추가"` → Edit + Drive 복사본 갱신
9. [ ] 세션 내 `"진행해"` → Jira 상태 전환 + executing-plans 호출

## 16. Phase 2 대비 (웹 대시보드)

이미 반영된 확장 포인트:
- `lib/normalize.ts` 독립 모듈
- `dashboard.json` 단일 진실의 원천
- 프론트매터 스키마 고정

Phase 2 시작 시:
- `~/Documents/Claude/dashboard/` Next.js 프로젝트 생성
- `dashboard.json` 을 fetch/import 하여 렌더
- 플랜 수정·상태 전환 버튼 추가 (기존 lib 재사용)

## 17. 구현 순서 (구현 플랜에서 상세화)

1. 설정·공통 라이브러리 (`boards.yaml` 타입, `normalize.ts`, `jira-client.ts`, `telegram.ts`)
2. Google Drive 동기화 (`drive-sync.ts`, `sync-drive.ts`)
3. 플랜 작성 오케스트레이터 (`claude-runner.ts`, `poll-jira.ts`)
4. 리마인드 (`remind-stale.ts`)
5. launchd 등록
6. 각 프로젝트 CLAUDE.md 업데이트
7. `--dry-run` 검증
8. 운영 전환

## 18. 열린 이슈 / 추후 결정

- 비-Jira 경로(개인톡)로 오는 업무 → Jira 이슈 자동 생성 후 파이프라인 태우는 기능 (Phase 3)
- 플랜 본문 안에 진행률·체크박스 도입 여부
- 자동 커밋 도입 여부 (현재는 untracked로 두고 사용자 수동 커밋 — 기존 팀 관행과 일치)
