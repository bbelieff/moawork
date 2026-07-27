export const RESERVED_WORKSPACE_SLUGS = new Set([
  "account",
  "admin",
  "api",
  "auth",
  "boards",
  "contract",
  "dash",
  "login",
  "logout",
  "newcust",
  "notices",
  "onboarding",
  "platform",
  "policyfund",
  "settings",
  "support",
  "w",
  "work",
  "workspace-entry",
  "workspaces",
  "www",
  "_next",
]);

export type WorkspaceRequestKind = "create" | "join" | "cancel" | "select_workspace" | "resolve_create" | "resolve_join";

export type WorkspaceRequestInput = {
  kind: WorkspaceRequestKind;
  displayName?: string;
  slug?: string;
  lookup?: string;
  requestId?: string;
  workspaceId?: string;
  approve?: boolean;
};

export type WorkspaceRequestResult =
  | { ok: true; state: "pending" | "expired" | "cancelled" | "approved" | "rejected" | "selection_revalidation"; message: string; redirectTo?: `/w/${string}` }
  | { ok: false; state: "invalid" | "unavailable"; message: string };

const slugPattern = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const WORKSPACE_ENTRY_RESUME_COOKIE = "mw_entry_resume";

export function workspaceEntryResumeValue(kind: "create" | "join", requestId: string): string | null {
  return uuidPattern.test(requestId) ? `${kind}.${requestId.toLowerCase()}` : null;
}

export function parseWorkspaceEntryResume(value: unknown): { kind: "create" | "join"; requestId: string } | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^(create|join)\.(.+)$/);
  return match && uuidPattern.test(match[2]) ? { kind: match[1] as "create" | "join", requestId: match[2].toLowerCase() } : null;
}

export function normalizeWorkspaceSlug(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function validateWorkspaceSlug(value: string): string | null {
  const slug = normalizeWorkspaceSlug(value);
  if (!slugPattern.test(slug) || RESERVED_WORKSPACE_SLUGS.has(slug)) {
    return "이 회사 주소는 사용할 수 없어요. 다른 주소를 선택해 주세요.";
  }
  return null;
}

export function parseWorkspaceRequest(value: unknown):
  | { ok: true; input: WorkspaceRequestInput }
  | { ok: false; message: string } {
  if (!value || typeof value !== "object") return { ok: false, message: "요청을 확인할 수 없어요." };
  const input = value as Record<string, unknown>;
  const kind = input.kind;
  if (kind !== "create" && kind !== "join" && kind !== "cancel" && kind !== "select_workspace" && kind !== "resolve_create" && kind !== "resolve_join") {
    return { ok: false, message: "요청을 확인할 수 없어요." };
  }

  const stringField = (name: string) => typeof input[name] === "string" ? input[name].trim() : undefined;
  const parsed: WorkspaceRequestInput = {
    kind,
    displayName: stringField("displayName"),
    slug: stringField("slug"),
    lookup: stringField("lookup"),
    requestId: stringField("requestId"),
    workspaceId: stringField("workspaceId"),
    approve: typeof input.approve === "boolean" ? input.approve : undefined,
  };

  if (kind === "create") {
    if (!parsed.displayName || parsed.displayName.length > 80) return { ok: false, message: "회사 이름을 1~80자로 입력해 주세요." };
    if (!parsed.slug || validateWorkspaceSlug(parsed.slug)) return { ok: false, message: "이 회사 주소는 사용할 수 없어요." };
  }
  if (kind === "join" && (!parsed.lookup || parsed.lookup.length > 256)) return { ok: false, message: "요청을 확인할 수 없어요." };
  if ((kind === "create" || kind === "join" || kind === "cancel" || kind === "resolve_create" || kind === "resolve_join") && (!parsed.requestId || !uuidPattern.test(parsed.requestId))) return { ok: false, message: "요청을 확인할 수 없어요." };
  if ((kind === "resolve_create" || kind === "resolve_join") && parsed.approve === undefined) return { ok: false, message: "요청을 확인할 수 없어요." };
  if (kind === "select_workspace" && !parsed.workspaceId) return { ok: false, message: "요청을 확인할 수 없어요." };
  return { ok: true, input: parsed };
}

/**
 * DB/RPC 계약이 배포되기 전에는 성공을 가장하지 않는다. 구현 시 이 adapter만
 * authenticated anon client의 승인된 RPC로 교체하며 service-role과 org_members DML은 금지한다.
 */
export async function submitWorkspaceRequest(input: WorkspaceRequestInput): Promise<WorkspaceRequestResult> {
  const response = await fetch("/api/workspace-requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return response.json() as Promise<WorkspaceRequestResult>;
}
