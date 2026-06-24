/**
 * TaskFlow Analytics — Snowplow setup example
 *
 * Workflow:
 *   1. Analysts edit events/*.yaml (this tracking plan)
 *   2. CI runs: opentp generate typescript --out src/analytics/generated/
 *   3. This file imports the generated typed tracker and initialises Snowplow
 *
 * To generate the typed tracker locally:
 *   npx opentp generate typescript \
 *     --plan opentp-spec/examples/taskflow/opentp.yaml \
 *     --out src/analytics/generated/
 */

import { createTracker } from "@opentp/sdk";
import { snowplow } from "@opentp/sdk/snowplow";

// ─── 1. Generated tracker (produced by `opentp generate typescript`) ───────────
// The CLI outputs a file like this from your YAML events. It contains full
// TypeScript types for every event payload so you get autocomplete + compile-time
// safety. Import it once and re-export from your analytics module.
import { events } from "./generated/tracker"; // auto-generated — do not edit manually

// ─── 2. Snowplow adapter configuration ────────────────────────────────────────
//
// In browser mode the adapter delegates to @snowplow/browser-tracker (must be
// loaded separately). In http mode it posts directly to your collector — good
// for server-side or edge tracking.
//
// Schema URIs follow the Iglu format:
//   iglu:{vendor}/{event_name}/jsonschema/{version}
//   e.g. iglu:io.taskflow/login_success/jsonschema/1-0-0

const snowplowAdapter = snowplow({
  mode: "http",
  vendor: "io.taskflow",
  defaultSchemaVersion: "1-0-0",

  // Snowplow collector endpoint — replace with your real URL.
  // For development: use Snowplow Micro (docker run -p 9090:9090 snowplow/snowplow-micro)
  collectorUrl: process.env.SNOWPLOW_COLLECTOR_URL ?? "http://localhost:9090",

  // Context entities: fields pulled OUT of the main event payload and sent
  // as separate Snowplow entities. This lets you join events by user/workspace
  // in your data warehouse without denormalising every row.
  contexts: {
    user: {
      fields: ["user_id"],
      version: "1-0-0",
    },
    workspace: {
      fields: ["workspace_id"],
      version: "1-0-0",
    },
    session: {
      fields: ["session_id"],
      version: "1-0-0",
    },
  },

  // Fields consumed by Snowplow infrastructure — skip from the event payload.
  excludeFields: ["app_id", "event_name"],

  // Per-event schema version overrides (bump when payload shape changes).
  schemaVersionMap: {
    "auth::login_success": "1-0-0",
    "auth::signup_completed": "1-0-0",
    "onboarding::step_completed": "1-0-0",
    "dashboard::viewed": "1-0-0",
    "projects::project_created": "1-0-0",
    "tasks::task_created": "1-0-0",
    "tasks::task_status_changed": "1-0-0",
    "tasks::task_assigned": "1-0-0",
    "search::search_performed": "1-0-0",
    "billing::plan_upgraded": "1-0-0",
    "settings::notification_preferences_updated": "1-0-0",
    "navigation::page_viewed": "1-0-0",
  },
});

// ─── 3. Create the tracker ─────────────────────────────────────────────────────
export const tracker = createTracker(events, {
  adapters: [snowplowAdapter],

  // Consent gate: events are held until consent is confirmed.
  // Call tracker.consent.grant() after the user accepts cookies.
  consent: {
    required: true,
    categories: ["analytics"],
  },

  // Batch events for 500 ms before flushing — reduces collector round-trips.
  queue: {
    enabled: true,
    flushInterval: 500,
    maxBatchSize: 20,
  },

  // Debug mode: logs every event to the browser console in development.
  debug: process.env.NODE_ENV === "development",
});

// ─── 4. Usage examples ─────────────────────────────────────────────────────────
//
// All methods below are fully typed. TypeScript will error if you:
//   • Pass a value not in the enum (e.g. auth_method: 'twitter')
//   • Omit a required field
//   • Pass the wrong type (e.g. is_mfa_enabled: 'yes')
//
// The generated method names follow the pattern: {area}{PascalEvent}
// e.g. key auth::login_success → tracker.authLoginSuccess(...)

// --- Auth: login ---
tracker.authLoginSuccess({
  auth_method: "google_oauth",
  is_mfa_enabled: true,
  login_attempt_count: 1,
  user_id: "usr_2xQkL9mPv",
  user_email: "jane.doe@acme.com",
  workspace_id: "ws_7Ry3Tnb",
  app_version: "2.4.1",
  session_id: "sess_Hx9pQ8w",
});

// --- Auth: signup ---
tracker.authSignupCompleted({
  signup_method: "google_oauth",
  referral_source: "product_hunt",
  plan_selected: "starter",
  company_size: "11_50",
  intended_use: "software_development",
  user_id: "usr_newUser01",
  user_email: "founder@startup.io",
  workspace_id: "ws_brand_new",
  app_version: "2.4.1",
});

// --- Onboarding: step completed ---
tracker.onboardingStepCompleted({
  step_name: "invite_teammates",
  step_number: 4,
  total_steps: 7,
  time_spent_seconds: 62,
  was_skipped: false,
  onboarding_variant: "engineering_focus",
  user_id: "usr_newUser01",
  workspace_id: "ws_brand_new",
  app_version: "2.4.1",
});

// --- Dashboard: viewed ---
tracker.dashboardViewed({
  dashboard_type: "my_work",
  active_projects_count: 5,
  overdue_tasks_count: 3,
  load_time_ms: 420,
  referrer_page: "login",
  user_id: "usr_2xQkL9mPv",
  workspace_id: "ws_7Ry3Tnb",
  app_version: "2.4.1",
});

// --- Projects: project created ---
tracker.projectsProjectCreated({
  project_id: "proj_AbCdEf123",
  project_template: "software_sprint",
  visibility: "team",
  member_count: 6,
  has_due_date: true,
  creation_context: "sidebar_button",
  user_id: "usr_2xQkL9mPv",
  workspace_id: "ws_7Ry3Tnb",
  app_version: "2.4.1",
});

// --- Tasks: task created ---
tracker.tasksTaskCreated({
  task_id: "task_xyz789",
  project_id: "proj_AbCdEf123",
  task_type: "bug",
  priority: "high",
  has_due_date: true,
  has_assignee: true,
  has_labels: false,
  creation_context: "board_view",
  user_id: "usr_2xQkL9mPv",
  workspace_id: "ws_7Ry3Tnb",
  app_version: "2.4.1",
});

// --- Tasks: status changed (completing a task) ---
tracker.tasksTaskStatusChanged({
  task_id: "task_xyz789",
  project_id: "proj_AbCdEf123",
  from_status: "in_review",
  to_status: "done",
  change_method: "drag_drop",
  is_completion: true,
  task_age_days: 4,
  was_overdue: false,
  user_id: "usr_2xQkL9mPv",
  workspace_id: "ws_7Ry3Tnb",
  app_version: "2.4.1",
});

// --- Tasks: task assigned ---
tracker.tasksTaskAssigned({
  task_id: "task_xyz789",
  project_id: "proj_AbCdEf123",
  is_self_assign: false,
  is_reassign: true,
  assignee_role: "member",
  assignment_context: "task_detail",
  user_id: "usr_2xQkL9mPv",
  workspace_id: "ws_7Ry3Tnb",
  app_version: "2.4.1",
});

// --- Search: query submitted ---
tracker.searchSearchPerformed({
  search_scope: "global",
  result_count: 14,
  query_length: 9, // "fix login" → 9 chars, never the raw query
  has_filters: true,
  filters_applied: ["assignee", "status"],
  result_clicked: true,
  clicked_result_position: 2,
  user_id: "usr_2xQkL9mPv",
  workspace_id: "ws_7Ry3Tnb",
  app_version: "2.4.1",
});

// --- Billing: plan upgrade ---
// Typically fired server-side after payment confirmation to avoid ad-blockers.
tracker.billingPlanUpgraded({
  from_plan: "starter",
  to_plan: "business",
  billing_cycle: "annual",
  seats_count: 25,
  upgrade_trigger: "seat_limit_reached",
  trial_days_used: 0,
  mrr_delta_usd: 500,
  user_id: "usr_adminAbc",
  workspace_id: "ws_7Ry3Tnb",
  app_version: "2.4.1",
});

// --- Settings: notification preferences ---
tracker.settingsNotificationPreferencesUpdated({
  changed_settings: ["email_digest", "mobile_push"],
  email_notifications_enabled: true,
  push_notifications_enabled: false,
  digest_frequency: "daily",
  settings_section: "notifications",
  user_id: "usr_2xQkL9mPv",
  workspace_id: "ws_7Ry3Tnb",
  app_version: "2.4.1",
});

// --- Navigation: page view (fire on every route change) ---
tracker.navigationPageViewed({
  page_name: "project_board",
  page_path: "/projects/proj_AbCdEf123/board",
  referrer_page_name: "dashboard",
  load_time_ms: 185,
  is_first_visit: false,
  user_id: "usr_2xQkL9mPv",
  workspace_id: "ws_7Ry3Tnb",
  app_version: "2.4.1",
  session_id: "sess_Hx9pQ8w",
});
