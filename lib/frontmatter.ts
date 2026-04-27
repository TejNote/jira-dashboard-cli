import matter from 'gray-matter';
import { stringify as stringifyYaml } from 'yaml';
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
  // Convert Date objects back to strings (YAML parser converts ISO 8601 to Date)
  const normalized = {
    ...parsed.data,
    created: typeof parsed.data.created === 'string' ? parsed.data.created : (parsed.data.created as any).toISOString?.() || String(parsed.data.created),
  };
  const data = FrontmatterSchema.parse(normalized) as PlanFrontmatter;
  return { data, content: parsed.content };
}

export function stringifyFrontmatter(data: PlanFrontmatter, content: string): string {
  const yaml = stringifyYaml(data, null, { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n\n${content.trimStart()}`;
}
