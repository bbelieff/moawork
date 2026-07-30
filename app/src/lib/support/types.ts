/**
 * 지원(1:1 문의) + 접근위임 도메인 타입 — T08.
 *
 * 저장 정본은 `supabase/migrations/017_support_access_delegation.sql`.
 * 여기 상수·규칙은 그 마이그레이션과 **1:1로 대응**해야 한다(둘 중 하나만 바꾸지 말 것).
 */

/** 1:1 문의 스레드 상태. */
export const SUPPORT_THREAD_STATUSES = ["open", "answered", "closed"] as const;
export type SupportThreadStatus = (typeof SUPPORT_THREAD_STATUSES)[number];

/** 메시지 작성자 축 — 고객사 멤버 / 플랫폼 운영자. */
export const SUPPORT_AUTHOR_KINDS = ["customer", "operator"] as const;
export type SupportAuthorKind = (typeof SUPPORT_AUTHOR_KINDS)[number];

/** 위임 범위. `write` 는 owner/admin 만 선택할 수 있다(멤버는 read 로 고정). */
export const ACCESS_GRANT_MODES = ["read", "write"] as const;
export type AccessGrantMode = (typeof ACCESS_GRANT_MODES)[number];

/** 감사 이벤트 행위. */
export const ACCESS_EVENT_ACTIONS = ["view", "export", "update", "download"] as const;
export type AccessEventAction = (typeof ACCESS_EVENT_ACTIONS)[number];

/** 알림 종류 — 뱃지 숫자의 원천. */
export const SUPPORT_NOTIFY_KINDS = [
  "support_reply",
  "grant_started",
  "grant_ended",
] as const;
export type SupportNotifyKind = (typeof SUPPORT_NOTIFY_KINDS)[number];

/**
 * 자동 첨부하는 **진단 컨텍스트 화이트리스트**.
 *
 * belie 지시: 고객사명·대표자명·연락처·금액은 **자동 첨부하지 않는다**.
 * 008 마이그레이션의 `support_threads_diag_whitelist` CHECK 와 동일 목록이어야 한다.
 */
export const DIAG_KEYS = [
  "path",
  "org_slug",
  "role",
  "app_version",
  "browser",
  "last_error_id",
] as const;
export type DiagKey = (typeof DIAG_KEYS)[number];

export type DiagContext = Partial<Record<DiagKey, string>>;

/** 위임 기간 프리셋. 기본값 = 2시간(belie 확정). */
export interface GrantDurationPreset {
  id: string;
  label: string;
  /** 분. `null` 이면 런타임 계산(오늘 안 = KST 자정까지). */
  minutes: number | null;
}

export const GRANT_DURATIONS: readonly GrantDurationPreset[] = [
  { id: "30m", label: "30분", minutes: 30 },
  { id: "2h", label: "2시간", minutes: 120 },
  { id: "today", label: "오늘 안", minutes: null },
] as const;

/** 기본 선택 프리셋 id. */
export const DEFAULT_GRANT_DURATION_ID = "2h";
/** 기본 위임 범위 — 보기만. */
export const DEFAULT_GRANT_MODE: AccessGrantMode = "read";
/** 008 `create_access_grant` 가 강제하는 상한(24시간). */
export const MAX_GRANT_MINUTES = 1440;

export interface SupportThread {
  id: string;
  org_id: string;
  opened_by: string;
  subject: string;
  status: SupportThreadStatus;
  diag: DiagContext;
  created_at: string;
  updated_at: string;
  last_message_at: string;
}

export interface SupportMessage {
  id: string;
  thread_id: string;
  org_id: string;
  author_id: string | null;
  author_kind: SupportAuthorKind;
  body: string;
  attachments: string[];
  created_at: string;
}

export interface SupportNotification {
  id: string;
  org_id: string;
  user_id: string;
  kind: SupportNotifyKind;
  thread_id: string | null;
  grant_id: string | null;
  created_at: string;
  read_at: string | null;
}

export interface AccessGrant {
  id: string;
  org_id: string;
  granted_by: string;
  /** null = 특정 운영자 지정 없음(플랫폼 관리자 누구나). */
  grantee_admin: string | null;
  reason: string | null;
  mode: AccessGrantMode;
  granted_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
}

export interface AccessEvent {
  id: string;
  grant_id: string;
  at: string;
  action: AccessEventAction;
  target_table: string | null;
  target_id: string | null;
}

/** 위임 생성 입력. */
export interface NewAccessGrant {
  minutes: number;
  mode?: AccessGrantMode;
  reason?: string | null;
  grantee_admin?: string | null;
}

/** 문의 작성 입력. */
export interface NewSupportThread {
  subject: string;
  body: string;
  diag?: DiagContext;
}

/** 위임이 지금 살아 있는가(만료·중단 모두 아님). */
export function isGrantActive(grant: AccessGrant, now: Date = new Date()): boolean {
  return (
    grant.revoked_at === null && new Date(grant.expires_at).getTime() > now.getTime()
  );
}

/** 남은 시간(밀리초). 만료·중단이면 0. */
export function grantRemainingMs(grant: AccessGrant, now: Date = new Date()): number {
  if (!isGrantActive(grant, now)) return 0;
  return new Date(grant.expires_at).getTime() - now.getTime();
}

/** 배너 문구용 남은 시간 — "1시간 42분" / "8분". */
export function formatRemaining(ms: number): string {
  const totalMinutes = Math.max(0, Math.ceil(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}분`;
  if (minutes === 0) return `${hours}시간`;
  return `${hours}시간 ${minutes}분`;
}

/**
 * "오늘 안" 프리셋의 실제 분 수 — KST 자정까지. 최소 1분, 최대 24시간.
 * 자정 직전이면 30분 프리셋보다 짧아질 수 있는데 그게 맞다(오늘을 넘기지 않는다).
 */
export function minutesUntilKstMidnight(now: Date = new Date()): number {
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const kstNow = now.getTime() + KST_OFFSET_MS;
  const msIntoDay = kstNow % 86_400_000;
  const remaining = 86_400_000 - msIntoDay;
  return Math.min(MAX_GRANT_MINUTES, Math.max(1, Math.ceil(remaining / 60_000)));
}

/** 프리셋 id → 분. 알 수 없는 id 는 기본값(2시간). */
export function resolveDurationMinutes(
  presetId: string,
  now: Date = new Date(),
): number {
  const preset = GRANT_DURATIONS.find((d) => d.id === presetId);
  if (!preset) return 120;
  return preset.minutes ?? minutesUntilKstMidnight(now);
}
