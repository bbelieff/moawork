// Wave B analytics contract.
//
// Only categorical product signals are allowed. Customer names, email addresses,
// workspace slugs, search text, raw query values, record ids, and free text have
// no field in this contract. Unknown event names are dropped by before_send.

// 네이밍 규약(배정 확정): **영역.대상.행동** — 소문자 · 스네이크.
//   영역 = auth | org | crm | settle | board | support | admin
// 아래 WAVE_B_EVENTS 4종은 규약 이전에 배선된 것이라 예외로 남긴다(호출부가 실제로 쓴다).
// 새 이벤트는 반드시 규약을 따르며, events.test.ts 가 정규식으로 강제한다.

/**
 * Wave B 에서 이미 배선된 이벤트 4종.
 * 실제 호출부가 있다(로그인·워크스페이스 진입 흐름) — 이름을 바꾸면 그 화면들이 깨진다.
 */
export const WAVE_B_EVENTS = [
  "login_result",
  "workspace_entry_state",
  "workspace_request_result",
  "first_workspace_entered",
] as const;

/**
 * 배정 확정 이벤트 10종(영역.대상.행동).
 * 값(id)만 싣고 사람이 읽는 문자열(상호·이름·연락처·메모·금액)은 싣지 않는다.
 */
export const ASSIGNED_EVENTS = [
  "auth.login.succeeded",
  "org.workspace.switched",
  "crm.deal.created",
  "crm.deal.stage_changed",
  "settle.settlement.saved",
  "board.column.created",
  "support.thread.opened",
  "support.grant.approved",
  "admin.console.viewed",
  "admin.breakglass.started",
] as const;

/** 전송이 허용되는 커스텀 이벤트 — Wave B 4 + 배정 10 = 14종. */
export const CUSTOM_EVENTS = [...WAVE_B_EVENTS, ...ASSIGNED_EVENTS] as const;

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

  // ── 배정 확정 10종 ──────────────────────────────────────────────
  // ⚠ 금액(실행액·수수료·매출·계약금)은 어떤 이벤트에도 넣지 않는다 — 타입에 자리가 없다.
  "auth.login.succeeded": {
    /** 로그인 수단 키(예: "google"). 이메일·이름은 싣지 않는다. */
    method?: string;
    duration_ms?: number;
  };
  "org.workspace.switched": {
    /** 이동 대상 조직 UUID. 조직명·slug 는 싣지 않는다. */
    to_org_id: string;
    from_org_id?: string;
  };
  "crm.deal.created": {
    deal_id: string;
    /** 파이프라인·단계는 식별자만. 단계 '이름'은 사용자가 바꿀 수 있어 싣지 않는다. */
    pipeline_id?: string;
    stage_id?: string;
    /** 유입 화면 키(예: "board" | "newcust"). 자유 문자열이 아니다. */
    source?: string;
  };
  "crm.deal.stage_changed": {
    deal_id: string;
    from_stage_id: string;
    to_stage_id: string;
  };
  "settle.settlement.saved": {
    settlement_id: string;
    deal_id?: string;
    /** 신규 작성인지 수정인지. **금액은 싣지 않는다.** */
    mode?: "create" | "update";
  };
  "board.column.created": {
    board_id: string;
    column_id: string;
    /** 컬럼 타입 키(예: "status" | "number"). 컬럼 라벨은 싣지 않는다. */
    column_type?: string;
  };
  "support.thread.opened": {
    thread_id: string;
    /** 문의 분류 키. 본문·제목은 절대 싣지 않는다. */
    category?: string;
  };
  "support.grant.approved": {
    grant_id: string;
    target_org_id?: string;
    ttl_minutes?: number;
  };
  "admin.console.viewed": {
    /** 콘솔 내 화면 키(예: "orgs" | "audit"). */
    section?: string;
  };
  "admin.breakglass.started": {
    /** 긴급 접근 사유 **코드**(자유 서술 금지). */
    reason_code: string;
    target_org_id?: string;
    ttl_minutes?: number;
  };
};

/**
 * 모든 커스텀 이벤트에 반드시 실리는 속성(배정 확정).
 * 호출부가 넘기지 않아도 채워진다 —
 *   app_version : useTrack 이 매 이벤트에 주입(빌드 상수라 로그인 전에도 붙는다)
 *   나머지 3종  : AnalyticsIdentity 가 super property 로 등록 → SDK 가 자동 첨부
 *
 * 넷 다 PII 가 아니다 — 조직 UUID · 역할 enum · 요금제 enum · 빌드 버전.
 */
export type RequiredEventProperties = {
  org_id: string;
  role: string;
  plan_tier: string;
  app_version: string;
};

/**
 * 비용 가드 — 무료 한도 월 100만 이벤트.
 * 값 < 1 이면 그 비율만 전송한다. 저빈도·고가치(계약·정산·권한)는 1 로 두고,
 * 초과 조짐이 보이면 고빈도·저가치부터 낮춘다.
 *
 * ⚠ `$snapshot` 은 넣지 않는다 — 리플레이는 조각 이벤트라 일부만 버리면 재생이 깨진다.
 *   리플레이 볼륨은 PostHog 쪽 샘플링으로 조절한다.
 */
export const EVENT_SAMPLE_RATE: Readonly<Partial<Record<string, number>>> = {
  // 고빈도 · 상대적 저가치 — 초과 조짐이 보이면 여기부터 내린다.
  $pageview: 1,
  workspace_entry_state: 1,
  "admin.console.viewed": 1,
  "org.workspace.switched": 1,
  // 미지정 이벤트는 1 = 전량 전송.
};

/**
 * 샘플링 판정 규칙(순수) — 비율과 난수만 보고 결정한다.
 * 상수를 건드리지 않고 규칙 자체를 테스트할 수 있도록 분리했다.
 */
export function sampleDecision(rate: number, rand: number): boolean {
  if (!Number.isFinite(rate) || rate >= 1) return true;
  if (rate <= 0) return false;
  return rand < rate;
}

/** 샘플링 통과 여부. rand 를 주입받아 테스트가 결정적으로 돈다. */
export function passesSampling(event: string, rand: number = Math.random()): boolean {
  return sampleDecision(EVENT_SAMPLE_RATE[event] ?? 1, rand);
}

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
