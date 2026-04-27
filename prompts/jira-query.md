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
