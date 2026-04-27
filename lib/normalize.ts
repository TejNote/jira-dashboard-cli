import type { BoardConfig, Category, Defaults, JiraIssue } from '../types';

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
