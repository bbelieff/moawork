// Wave B analytics contract.
//
// Only categorical product signals are allowed. Customer names, email addresses,
// workspace slugs, search text, raw query values, record ids, and free text have
// no field in this contract. Unknown event names are dropped by before_send.

export const CUSTOM_EVENTS = [
  "login_result",
  "workspace_entry_state",
  "workspace_request_result",
  "first_workspace_entered",
] as const;

export const LOGIN_ATTEMPT_MARKER = "mw-analytics-login-attempt";

// Session replay is allowed only under the masking policy in config.ts. Page
// transitions use $pageview with a normalized pathname template.
export const SDK_EVENTS = ["$pageview", "$snapshot"] as const;

export const ALLOWED_EVENTS: readonly string[] = [...CUSTOM_EVENTS, ...SDK_EVENTS];
const ALLOWED_EVENT_SET: ReadonlySet<string> = new Set(ALLOWED_EVENTS);

export function isAllowedEvent(event: string): boolean {
  return ALLOWED_EVENT_SET.has(event);
}

export type CustomEventName = (typeof CUSTOM_EVENTS)[number];

export type LoginFailureReason =
  | "oauth_start"
  | "auth_callback"
  | "profile"
  | "membership"
  | "configuration"
  | "unknown";

export type WorkspaceEntryState =
  | "choose_path"
  | "create"
  | "join"
  | "pending"
  | "rejected"
  | "blocked"
  | "operator"
  | "chooser";

export type AnalyticsEventPayloads = {
  login_result: {
    outcome: "success" | "failure";
    reason?: LoginFailureReason;
  };
  workspace_entry_state: {
    state: WorkspaceEntryState;
  };
  workspace_request_result: {
    kind: "create" | "join";
    outcome: "success" | "failure";
  };
  first_workspace_entered: {
    entry: "canonical";
  };
};

export type EventPropertyValue = string | number | boolean | null | undefined;

export type AnalyticsRouteTemplate =
  | "/"
  | "/login"
  | "/auth/callback"
  | "/workspace-entry"
  | "/workspaces"
  | "/w/:workspace"
  | "/dash/:view"
  | "/boards/:board"
  | "/deals/:deal"
  | "/settings/account"
  | "/settings/members"
  | "/platform/workspace-requests"
  | "/other";

/** Convert a browser pathname to a finite template. Dynamic values never leave the browser. */
export function analyticsRouteTemplate(pathname: string): AnalyticsRouteTemplate {
  const path = pathname.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
  if (path === "/") return "/";
  if (path === "/login") return "/login";
  if (path === "/auth/callback") return "/auth/callback";
  if (path === "/workspace-entry") return "/workspace-entry";
  if (path === "/workspaces") return "/workspaces";
  if (/^\/w\/[^/]+(?:\/.*)?$/.test(path)) return "/w/:workspace";
  if (path === "/dash") return "/dash/:view";
  if (/^\/dash\/.+$/.test(path)) return "/dash/:view";
  if (path === "/boards") return "/boards/:board";
  if (/^\/boards\/.+$/.test(path)) return "/boards/:board";
  if (path === "/deals") return "/deals/:deal";
  if (/^\/deals\/.+$/.test(path)) return "/deals/:deal";
  if (/^\/(?:account|settings\/account)(?:\/.*)?$/.test(path)) return "/settings/account";
  if (/^\/settings\/members(?:\/.*)?$/.test(path)) return "/settings/members";
  if (path === "/platform/workspace-requests") return "/platform/workspace-requests";
  return "/other";
}

/** Map known login error query values to bounded categories; raw values are never returned. */
export function loginFailureReason(value: string | null | undefined): LoginFailureReason | null {
  if (!value) return null;
  if (value === "auth") return "auth_callback";
  if (value === "profile") return "profile";
  if (value === "membership") return "membership";
  if (value === "config") return "configuration";
  return "unknown";
}
