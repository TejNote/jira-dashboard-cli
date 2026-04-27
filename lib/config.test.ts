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
