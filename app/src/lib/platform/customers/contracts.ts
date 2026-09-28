/**
 * ADMIN 고객 운영(고객사 대장) 계약 — 순수 타입·라벨·파서.
 *
 * 서버 전용 코드(createClient 등)를 두지 않는다. 클라이언트 컴포넌트와
 * 서버 로더가 함께 import한다. RPC 원형 검증은 여기서만 한다 — 깨진 행을
 * 화면이 0건·빈값으로 위장하지 않도록, 형식이 어긋나면 null이다.
 */

export const CUSTOMER_SETUP_STATUSES = ["setting_up", "active"] as const;
export type CustomerSetupStatus = (typeof CUSTOMER_SETUP_STATUSES)[number];

export const CUSTOMER_INVITE_STATES = ["pending", "sent", "active"] as const;
export type CustomerInviteState = (typeof CUSTOMER_INVITE_STATES)[number];

export const CUSTOMER_TASK_KINDS = ["setup", "support"] as const;
export type CustomerTaskKind = (typeof CUSTOMER_TASK_KINDS)[number];

export const CUSTOMER_TASK_STATUSES = ["todo", "in_progress", "done"] as const;
export type CustomerTaskStatus = (typeof CUSTOMER_TASK_STATUSES)[number];

export const CUSTOMER_LIST_FILTERS = ["all", "setting_up", "active"] as const;
export type CustomerListFilter = (typeof CUSTOMER_LIST_FILTERS)[number];

/** 첫 릴리스 업종. 폼은 고정 라벨로 보여주고 저장은 DB 기본값과 같은 값이다. */
export const CUSTOMER_INDUSTRY_FIXED = "경영컨설팅";

export function isCustomerSetupStatus(value: unknown): value is CustomerSetupStatus {
  return value === "setting_up" || value === "active";
}

export function isCustomerInviteState(value: unknown): value is CustomerInviteState {
  return value === "pending" || value === "sent" || value === "active";
}

export function isCustomerTaskKind(value: unknown): value is CustomerTaskKind {
  return value === "setup" || value === "support";
}

export function isCustomerTaskStatus(value: unknown): value is CustomerTaskStatus {
  return value === "todo" || value === "in_progress" || value === "done";
}

export function isCustomerListFilter(value: unknown): value is CustomerListFilter {
  return value === "all" || value === "setting_up" || value === "active";
}

export const SETUP_STATUS_LABEL: Record<CustomerSetupStatus, string> = {
  setting_up: "세팅 중",
  active: "이용 중",
};

export const INVITE_STATE_LABEL: Record<CustomerInviteState, string> = {
  pending: "초대 전",
  sent: "초대 안내함",
  active: "참여 완료",
};

export const TASK_KIND_LABEL: Record<CustomerTaskKind, string> = {
  setup: "초기 세팅",
  support: "지속 지원",
};

export const TASK_STATUS_LABEL: Record<CustomerTaskStatus, string> = {
  todo: "할 일",
  in_progress: "진행 중",
  done: "완료",
};

export type CustomerSummary = {
  orgId: string;
  name: string;
  slug: string | null;
  orgStatus: string;
  industry: string;
  setupStatus: CustomerSetupStatus;
  inviteState: CustomerInviteState;
  memberCount: number;
  openTaskCount: number;
  updatedAt: string;
};

export type CustomerTemplateState = {
  key: string | null;
  appliedAt: string | null;
};

export type CustomerDetail = CustomerSummary & {
  hasRep: boolean;
  canEnter: boolean;
  canManage: boolean;
  template: CustomerTemplateState;
};

export type CustomerTask = {
  taskId: string;
  title: string;
  kind: CustomerTaskKind;
  status: CustomerTaskStatus;
  createdAt: string;
  updatedAt: string;
};

export type CustomerHistoryEntry = {
  label: string;
  before: string;
  after: string;
  memo: string;
  taskId: string | null;
  createdAt: string;
};

/** 프로필 행이 없을 때의 업종 표시. 옛 회사를 기본값으로 단정하지 않는다. */
export const CUSTOMER_INDUSTRY_UNKNOWN = "미설정";

/** 템플릿 기록이 없을 때의 표시. 행 없음이 미적용 증거가 아니다. */
export const CUSTOMER_TEMPLATE_NO_RECORD = "적용 기록 없음";

/** 초대 안내 복사 문구. 이메일 발송을 주장하지 않는다. */
export const CUSTOMER_INVITE_APPROVAL_NOTE = "참여 요청 후 승인이 필요합니다";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return text(value);
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function parseCustomerSummary(value: unknown): CustomerSummary | null {
  const row = record(value);
  if (!row) return null;
  const orgId = text(row.org_id);
  const name = text(row.name);
  const updatedAt = text(row.updated_at);
  const memberCount = count(row.member_count);
  const openTaskCount = count(row.open_task_count);
  if (!orgId || !name || !updatedAt || memberCount === null || openTaskCount === null) return null;
  if (!isCustomerSetupStatus(row.setup_status) || !isCustomerInviteState(row.invite_state)) return null;
  const industry = text(row.industry);
  const orgStatus = text(row.org_status);
  if (!industry || !orgStatus) return null;
  return {
    orgId,
    name,
    slug: nullableText(row.slug),
    orgStatus,
    industry,
    setupStatus: row.setup_status,
    inviteState: row.invite_state,
    memberCount,
    openTaskCount,
    updatedAt,
  };
}

export function parseCustomerList(value: unknown): CustomerSummary[] | null {
  if (!Array.isArray(value)) return null;
  const out: CustomerSummary[] = [];
  for (const entry of value) {
    const parsed = parseCustomerSummary(entry);
    if (!parsed) return null;
    out.push(parsed);
  }
  return out;
}

export function parseCustomerDetail(value: unknown): CustomerDetail | null {
  const base = parseCustomerSummary(value);
  const row = record(value);
  if (!base || !row) return null;
  if (typeof row.has_rep !== "boolean" || typeof row.can_enter !== "boolean") return null;
  // can_manage는 구 DB 응답(배포 전)에는 없을 수 있다 — 없으면 초대 관리를 닫는다.
  const canManage = typeof row.can_manage === "boolean" ? row.can_manage : false;
  const template = record(row.template);
  if (!template) return null;
  const key = nullableText(template.key);
  const appliedAt = nullableText(template.applied_at);
  // 키 없이 시각만 있는 기록은 깨진 상태다 — 미적용으로 단정하지 않고 실패로 말한다.
  if (key === null && appliedAt !== null) return null;
  return { ...base, hasRep: row.has_rep, canEnter: row.can_enter, canManage, template: { key, appliedAt } };
}

export function parseCustomerTask(value: unknown): CustomerTask | null {
  const row = record(value);
  if (!row) return null;
  const taskId = text(row.task_id);
  const title = text(row.title);
  const createdAt = text(row.created_at);
  const updatedAt = text(row.updated_at);
  if (!taskId || !title || !createdAt || !updatedAt) return null;
  if (!isCustomerTaskKind(row.kind) || !isCustomerTaskStatus(row.status)) return null;
  return { taskId, title, kind: row.kind, status: row.status, createdAt, updatedAt };
}

export function parseCustomerTaskList(value: unknown): CustomerTask[] | null {
  if (!Array.isArray(value)) return null;
  const out: CustomerTask[] = [];
  for (const entry of value) {
    const parsed = parseCustomerTask(entry);
    if (!parsed) return null;
    out.push(parsed);
  }
  return out;
}

export function parseCustomerHistory(value: unknown): CustomerHistoryEntry[] | null {
  if (!Array.isArray(value)) return null;
  const out: CustomerHistoryEntry[] = [];
  for (const entry of value) {
    const row = record(entry);
    if (!row) return null;
    const label = text(row.label);
    const createdAt = text(row.created_at);
    if (!label || !createdAt) return null;
    if (typeof row.before !== "string" || typeof row.after !== "string" || typeof row.memo !== "string") return null;
    // task_id는 작업 저장소를 참조하는 연결자다. 없으면 null, 있으면 UUID 모양만 받는다.
    const rawTask = row.task_id;
    const taskId = rawTask === null || rawTask === undefined ? null
      : typeof rawTask === "string" && isCustomerId(rawTask) ? rawTask : null;
    if (rawTask !== null && rawTask !== undefined && taskId === null) return null;
    out.push({ label, before: row.before, after: row.after, memo: row.memo, taskId, createdAt });
  }
  return out;
}

/**
 * 이력의 before/after enum을 사람이 읽는 한국어로 바꾼다.
 * DB에는 고정 enum만 두고(원문 복사 금지) 표시는 여기서 한다.
 */
export function historyValueLabel(value: string): string {
  if (value === "") return "—";
  if (value === "없음") return "없음";
  if (value === "setting_up") return SETUP_STATUS_LABEL.setting_up;
  if (value === "active") return "이용 중·참여 완료";
  if (value === "pending") return INVITE_STATE_LABEL.pending;
  if (value === "sent") return "초대 안내함";
  if (value === "todo") return TASK_STATUS_LABEL.todo;
  if (value === "in_progress") return TASK_STATUS_LABEL.in_progress;
  if (value === "done") return TASK_STATUS_LABEL.done;
  return value;
}

/** 작업 목록 상한. DB도 200으로 묶고 화면도 그 이상을 전체로 말하지 않는다. */
export const CUSTOMER_TASK_LIST_LIMIT = 200;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isCustomerId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export type CustomerListQuery = { search: string; status: CustomerListFilter };

/** 목록 쿼리스트링을 읽는다. 이상하면 기본값(전체·빈 검색)으로 좁힌다. */
export function parseCustomerListQuery(value: unknown): CustomerListQuery {
  const row = record(value) ?? {};
  const rawSearch = typeof row.q === "string" ? row.q.trim().slice(0, 80) : "";
  const rawStatus = typeof row.status === "string" ? row.status : "all";
  return {
    search: rawSearch,
    status: isCustomerListFilter(rawStatus) ? rawStatus : "all",
  };
}

/**
 * 승인 기반 합류 초대의 안전한 주소. 토큰을 만들지 않고 기존 join 흐름의
 * 회사 주소만 싣는다. 검증되지 않은 값에는 null을 돌려준다.
 */
export function parseInviteJoinSlug(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").toLowerCase().trim()
    .replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(normalized)) return null;
  return normalized;
}

export function customerInviteJoinUrl(slug: string | null | undefined): string | null {
  const valid = typeof slug === "string" ? parseInviteJoinSlug(slug) : null;
  return valid ? `/workspace-entry?mode=new&join=${valid}` : null;
}

/** 작업 폼 입력 검증. 실패해도 호출부가 입력값을 그대로 들고 있게 한다. */
export function validateCustomerTaskInput(input: { title: string; kind: string }): string | null {
  if (input.title.trim().length < 1 || input.title.trim().length > 120) {
    return "작업 내용을 1~120자로 입력해 주세요.";
  }
  if (!isCustomerTaskKind(input.kind)) return "작업 구분을 확인해 주세요.";
  return null;
}
