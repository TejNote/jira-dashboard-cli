import { describe, it, expect } from 'vitest';
import {
  normalizeCategory,
  detectCancelledByDeletion,
} from './normalize';
import type { BoardConfig, Defaults, JiraIssue } from '../types';

const defaults: Defaults = {
  category_map: { new: 'pending', indeterminate: 'active', done: 'done' },
  cancelled_detection: { on_deletion: true, on_resolution: ["Won't Do", 'Duplicate'] },
};

const ceorBoard: BoardConfig = {
  project_key: 'PROJ', board_id: 1, session: 'main',
  parent_workspace: '/tmp/ceo', drive_folder: 'ceo',
  subprojects: [{ key: 'backend', path: 'be', description: '' }],
  name_overrides: {},
};

const utBoard: BoardConfig = {
  ...ceorBoard, project_key: 'OTHER', board_id: 2, session: 'other',
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
