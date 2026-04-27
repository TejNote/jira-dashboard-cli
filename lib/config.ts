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
