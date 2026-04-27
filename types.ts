// ~/Documents/Claude/scripts/jira-dashboard/types.ts

export type Category = 'pending' | 'active' | 'done' | 'cancelled';
export type JiraStatusCategoryKey = 'new' | 'indeterminate' | 'done';

export interface Subproject {
  key: string;
  path: string;
  description: string;
}

export interface BoardConfig {
  project_key: string;
  board_id: number;
  session: string;
  parent_workspace: string;
  drive_folder: string;
  subprojects: Subproject[];
  name_overrides: Record<string, Category>;
}

export interface CancelledDetection {
  on_deletion: boolean;
  on_resolution: string[];
}

export interface Defaults {
  category_map: Record<JiraStatusCategoryKey, Category>;
  cancelled_detection: CancelledDetection;
}

export interface RootConfig {
  jira: {
    host: string;
    assignee_account_id: string;
  };
  defaults: Defaults;
  google_drive_root: string;
  boards: Record<string, BoardConfig>;
}

export interface JiraStatus {
  name: string;
  statusCategory: {
    key: JiraStatusCategoryKey;
  };
}

export interface JiraResolution {
  name: string;
}

export interface JiraIssue {
  key: string;
  title: string;
  body: string;
  status: JiraStatus;
  resolution: JiraResolution | null;
  labels: string[];
  components: string[];
  updated: string; // ISO 8601
}

export interface PlanFrontmatter {
  jira: string;
  title: string;
  area: string;
  subproject: string;
  related: string[];
  suggested_branch: string;
  jira_url: string;
  created: string; // ISO 8601
}

export interface PlanFile {
  path: string; // 프로젝트 내 상대 경로 (예: "ceo-report-backend/plans/JIRA-CEOR-123-xxx.md")
  absolute_path: string;
  drive_path: string; // Drive 절대 경로
  frontmatter: PlanFrontmatter;
}

export interface DashboardIssueEntry {
  key: string;
  title: string;
  board: string;
  status_raw: string;
  status_category: JiraStatusCategoryKey;
  status_normalized: Category;
  jira_url: string;
  plans: Array<{
    subproject: string;
    area: string;
    path: string;         // subproject 내 상대 경로
    drive_path: string;   // 현재 Drive 상 절대 경로
  }>;
  plan_created_at: string;
  last_reminded_at: string | null;
}

export interface DashboardState {
  generated_at: string;
  issues: DashboardIssueEntry[];
}
