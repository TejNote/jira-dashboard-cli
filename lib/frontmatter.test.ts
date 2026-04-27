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
  jira_url: 'https://example.atlassian.net/browse/PROJ-123',
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
