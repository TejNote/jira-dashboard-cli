# jira-dashboard-cli 작업 지침

이 파일이 이 repository의 AI instruction 정본이다. `CLAUDE.md`는 `@AGENTS.md` 한 줄 셔틀이다.

Jira 배정 이슈를 폴링해서 **로컬 `plans/` 파일**로 변환하는 워크플로우 자동화 CLI. TypeScript + tsx 실행, vitest 테스트.

> ℹ️ Personal 프로젝트 — `~/.claude/CLAUDE.md`(전역) + `~/Documents/Personal/CLAUDE.md`만 적용된다. **Insudeal 회사 컨벤션은 적용 대상이 아니다.**
>
> ⚠️ 이 도구가 구동하던 자동 폴링·plan 생성·리마인드는 **2026-05-06 중단**됐다(운영 방식 부정합, launchd job `.disabled`). 코드는 남아 있으니 되살릴 때는 그 배경을 먼저 확인한다.

## 문서

- 설계·구현 plan: `plans/2026-04-17-jira-work-dashboard-{design,impl}.md` — **작업 전에 먼저 읽는다**
- 사용법: `README.md`
- 보드 설정 예시: `boards.yaml.example` (실제 `boards.yaml`은 커밋하지 않는다)

## 명령

```bash
npm run poll        # tsx poll-jira.ts     — Jira 배정 이슈 폴링 → plans/ 생성
npm run remind      # tsx remind-stale.ts  — 정체된 이슈 리마인드
npm run sync        # tsx sync-drive.ts    — Google Drive 동기화
npm test            # vitest run           — 커밋 전 통과 필수
npm run test:watch  # vitest
```

## 구조

| 위치 | 역할 |
|---|---|
| `poll-jira.ts` · `remind-stale.ts` · `sync-drive.ts` | 엔트리포인트 3개 |
| `lib/jira-client.ts` | Jira API 호출 |
| `lib/claude-runner.ts` | Claude 호출로 plan 본문 생성 |
| `lib/frontmatter.ts` | plan frontmatter 파싱·생성 (gray-matter) |
| `lib/config.ts` | `boards.yaml` 로드 (yaml + zod 검증) |
| `lib/dashboard-state.ts` · `lockfile.ts` | 상태 파일(`state/`) · 중복 실행 방지 |
| `lib/drive-sync.ts` | Drive 업로드 |
| `lib/normalize.ts` · `time.ts` | 이슈 정규화 · 시각 처리 |
| `lib/telegram.ts` · `logger.ts` | 알림 · 로깅 |
| `prompts/jira-query.md` · `plan-writer.md` | Claude 프롬프트 (동작 변경 시 여기부터 확인) |

`lib/`에는 `*.test.ts`가 함께 있다(`config` · `drive-sync` · `frontmatter` · `normalize`). **로직 변경 시 같은 파일의 테스트를 함께 갱신한다.**

## 작업 규칙

- 동작을 바꾸기 전 `prompts/`와 `plans/`의 설계 문서를 먼저 확인한다 — 프롬프트 한 줄이 산출물 형식을 바꾼다
- `state/`·`boards.yaml`·`.env`는 커밋하지 않는다. 토큰은 평문으로 어디에도 쓰지 않는다
- plan 파일 형식(frontmatter 필드)을 바꾸면 `lib/frontmatter.ts` + 해당 테스트 + `prompts/plan-writer.md` 3곳을 같이 맞춘다
- 커밋 전 `npm test` 통과 확인

## Push 룰

- `main` 직접 push는 문서·typo·config 같은 작은 변경만. 큰 코드 변경은 feature 브랜치 + PR
- `git push` 단독 실행 금지 (upstream tracking 위험)

## 개인 지침

@AGENTS.local.md

repository 루트에 `AGENTS.local.md`가 있으면 작업 시작 전에 읽고 따른다. 없으면 위 import는 무시된다.
