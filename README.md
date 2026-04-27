# Jira Work Dashboard

> Jira 배정 이슈를 매일 자동 폴링해서 **로컬 `plans/` 파일** 로 변환하는 워크플로우 자동화 도구.
> Claude Code (또는 다른 AI 에이전트) 와 결합해 "이슈 → 계획 → 실행" 사이클을 자연어 명령으로 실행.

**기획 의도**: 사람이 매일 Jira 를 직접 들여다보며 "오늘 뭐 할지" 정리하는 시간을 0 으로 줄이고, 자기 업무가 자동으로 정리된 plans 파일로 대기하게 함.

---

## 기능

- **매일 자동 폴링**: launchd (macOS) 또는 cron 으로 Jira `assignee = currentUser()` 이슈 수집
- **plans 파일 자동 생성**: `<YYYY-MM-DD>-<JIRA_KEY>-<slug>.md` 형식, frontmatter 포함
- **Drive 4분류 동기화** (선택): pending / active / done / cancelled 자동 이동
- **24h+ 미착수 리마인드** (선택): Telegram 알림
- **상태 머신**: Jira `statusCategory` 변화를 감지해 폴더 간 자동 이동
- **중복 통합 처리**: 한 이슈를 다른 통합 플랜에서 처리 중일 때 stub 으로 축소 + Relates 링크
- **자연어 트리거**: 각 프로젝트 `CLAUDE.md` 의 규칙 블록과 결합해 `"PROJ-123 진행해"` 한 마디로 작업 시작

---

## 의존성

- **Node.js 22 LTS** 이상
- **TypeScript** (`tsx` 로 직접 실행)
- **Atlassian Jira Cloud** 계정 + API Token
- **(선택) Google Drive**: rclone 또는 Google Drive 데스크톱 앱
- **(선택) Telegram Bot**: BotFather 로 봇 생성

---

## 빠른 시작 (5분)

### 1. 클론 + 의존성 설치

```bash
git clone https://github.com/TejNote/jira-dashboard-cli.git
cd jira-dashboard-cli
cd jira-dashboard
npm install
```

### 2. 설정 파일 복사 + 수정

```bash
cp boards.yaml.example boards.yaml
cp .env.example .env

# 본인 환경에 맞게 수정
$EDITOR boards.yaml      # Jira host, accountId, 보드 매핑
$EDITOR .env             # JIRA_EMAIL, JIRA_API_TOKEN, (선택) Telegram
```

### 3. Jira API Token 발급

1. https://id.atlassian.com/manage-profile/security/api-tokens
2. **Create API token** → 이름 입력 → 토큰 복사
3. `.env` 의 `JIRA_API_TOKEN` 에 붙여넣기

### 4. 본인 accountId 확인

```bash
# Atlassian MCP 가 인증된 Claude 세션에서:
"내 Jira accountId 알려줘"

# 또는 Jira UI 에서 Profile → URL 의 ?accountId=... 부분
```

`boards.yaml` 의 `jira.assignee_account_id` 에 입력.

### 5. 보드 매핑 작성

`boards.yaml` 의 `boards` 섹션에 자기 Jira 프로젝트 등록:

```yaml
boards:
  PROJ:
    project_key: PROJ
    board_id: 1                                              # Jira board URL ?board=N
    parent_workspace: /path/to/your/workspace
    drive_folder: my-project
    subprojects:
      - key: main
        path: my-project                                     # parent_workspace 기준 상대 경로
        description: "프로젝트 설명"
```

> 다중 subproject (모노레포) 또는 커스텀 워크플로우 예시는 `boards.yaml.example` 참조.

### 6. Dry-run 으로 검증

```bash
npx tsx poll-jira.ts --dry-run --board PROJ
```

→ 실제 파일 쓰지 않고 Jira 조회 결과만 출력. 매핑이 올바른지 확인.

### 7. 실제 실행

```bash
npx tsx poll-jira.ts --board PROJ
```

→ `<parent_workspace>/<subproject_path>/plans/<YYYY-MM-DD>-PROJ-XX-<slug>.md` 생성.

---

## 자동 스케줄 (macOS launchd)

### launcher 스크립트 작성

`~/.local/bin/jira-dashboard-poll.sh`:

```bash
#!/bin/bash
cd /path/to/jira-dashboard
exec /opt/homebrew/bin/npx tsx poll-jira.ts >> ~/.local/logs/jira-dashboard/poll-$(date +%Y%m%d).log 2>&1
```

```bash
chmod +x ~/.local/bin/jira-dashboard-poll.sh
mkdir -p ~/.local/logs/jira-dashboard
```

### launchd plist

`~/Library/LaunchAgents/com.USERNAME.jira-dashboard-poll.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.USERNAME.jira-dashboard-poll</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Users/USERNAME/.local/bin/jira-dashboard-poll.sh</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key><integer>9</integer>
        <key>Minute</key><integer>0</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>/Users/USERNAME/.local/logs/jira-dashboard/poll.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/USERNAME/.local/logs/jira-dashboard/poll.err</string>
</dict>
</plist>
```

> ⚠️ macOS 보안 제약: `~/Library/LaunchAgents/` 만 허용. `~/Documents/` 안 plist 는 실행 불가.

### 활성화

```bash
launchctl load ~/Library/LaunchAgents/com.USERNAME.jira-dashboard-poll.plist
launchctl list | grep jira-dashboard      # 등록 확인

# 수동 즉시 실행 (테스트)
launchctl start com.USERNAME.jira-dashboard-poll
```

---

## 명령어

```bash
# 매일 폴링 (기본)
npx tsx poll-jira.ts

# 특정 보드만
npx tsx poll-jira.ts --board PROJ

# 특정 이슈 강제 처리
npx tsx poll-jira.ts --board PROJ --issue PROJ-123

# Dry-run (Jira 조회만, 파일 쓰기 X)
npx tsx poll-jira.ts --dry-run

# 24h+ 미착수 리마인드
npx tsx remind-stale.ts

# Drive 폴더 재동기화 (Jira 상태 변화 반영)
npx tsx sync-drive.ts

# 테스트
npm test
```

---

## plans 파일 구조

자동 생성되는 plans 파일 예시:

```markdown
---
jira: PROJ-123
area: backend
subproject: my-project
suggested_branch: feat/PROJ-123-add-user-search
related: []
merged_into: null
---

# [PROJ-123] 사용자 검색 기능 추가

## 목표
- 회원 목록에서 이름·이메일로 실시간 검색

## 접근 방식
- ...

## 단계별 작업
1. ...
2. ...

## 영향 범위
- ...

## 완료 기준
- [ ] ...
```

---

## Claude 와의 결합

각 프로젝트의 `CLAUDE.md` 에 아래 블록을 추가하면 자연어 명령이 즉시 동작합니다:

```markdown
## Jira 플랜 자동 실행 규칙

`<JIRA_KEY> 진행해` / `실행` / `시작` 명령 처리:

1. `plans/` 에서 해당 키 파일 찾기 (없으면 Atlassian MCP 로 Jira read 후 생성)
2. `superpowers:executing-plans` 스킬 활성화
3. Jira 이슈 상태 → `진행 중` 전환
4. 진행 결과를 plans 파일 + Jira 코멘트로 동기화

`<JIRA_KEY> 수정해 ...` 명령:
- plans 파일 편집
- Drive 사본 동기화
- frontmatter `merged_into` 갱신 (필요 시)

`<JIRA_KEY> 보류` / `취소`:
- Jira 상태 변경 → 다음 sync 때 `cancelled/` 이동 (워크플로우에 따라 다름)

`<JIRA_KEY> 완료`:
- 사용자 컨펌 후 Jira 전환
- plans 파일 done/ 이동
```

> Jira 워크플로우는 프로젝트마다 다릅니다. **`해야 할 일 / 진행 중 / 완료` 3단계만** 있는 단순 워크플로우면 `보류` 명령은 동작 안 함 (해당 transition 부재). `boards.yaml` 의 `name_overrides` 로 커스텀 매핑 가능.

---

## 보안 / 개인정보

이 코드는 **단일 사용자 환경 기준** 으로 만들어졌습니다. 공개 시 다음을 확인하세요:

- ✅ `boards.yaml` 은 `.gitignore` 에 등록됨 — 회사 도메인·accountId·로컬 경로 비공개
- ✅ `.env` 은 `.gitignore` 에 등록됨 — API Token·봇 토큰 비공개
- ⚠️ `state/dashboard.json` 도 `.gitignore` (Jira 이슈 캐시 포함)
- ⚠️ 로그 파일에 Jira 응답이 포함될 수 있음 — 외부 공유 시 sanitize

**공개 안전 항목**: `*.ts`, `package.json`, `tsconfig.json`, `prompts/` (사내 도메인 키워드 제거 후), `*.example` 파일.

---

## 향후 계획

- [ ] **Linear / GitHub Issues 지원** — 현재 Jira 전용
- [ ] **Phase 2: 로컬 웹 대시보드** — `state/dashboard.json` 정규화 데이터를 Next.js 로 시각화
- [ ] **Slack 통합** — Telegram 외에 Slack DM/채널 알림
- [ ] **포지션별 분기** — 디자이너 환경 (Figma write) 자동 연동

---

## 라이선스

MIT (`LICENSE` 참조)

---

## 기여

- 이슈·PR 환영
- 코드 스타일: `npx tsc --noEmit && npx vitest run` 통과 필수
- 커밋 메시지: `feat:`, `fix:`, `docs:` 등 conventional commits 권장
