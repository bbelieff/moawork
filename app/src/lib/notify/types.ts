/**
 * mod.notify 도메인 타입.
 *
 * ★ 핵심 계약: "봤다"(read_at) 와 "했다"(resolved_at) 는 다른 축이다.
 *   - 숫자 뱃지 = 내가 할 일 = is_action && !resolved_at → 화면 진입으로 사라지지 않는다.
 *   - 점  뱃지 = 안 본 변화                              → 화면 진입으로 사라진다.
 */

/** 사이드바 nav key 와 동일한 화면 식별자(점 뱃지 부착 단위). */
export type SurfaceKey = string;

/** 알림 종류. 발송 지점이 늘면 여기에 추가한다. */
export const NOTIFICATION_TYPES = {
  /** 가입 요청 도착 → 오너에게 행동 필요(숫자). */
  joinRequest: "join_request",
  /** 나에게 배정됨. */
  assigned: "assigned",
  /** 나를 언급함. */
  mention: "mention",
  /** 나에게 요청됨. */
  requested: "requested",
} as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

/** notifications 테이블 1행(개인 인박스). */
export interface Notification {
  id: string;
  org_id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  target_type: string | null;
  target_id: string | null;
  actor_id: string | null;
  /** 행동 필요 = 숫자 뱃지 대상. */
  is_action: boolean;
  /** 봤다. 점 소거용 — 숫자에 영향 없음. */
  read_at: string | null;
  /** 했다. 숫자 소거용 — 이 값이 있어야 카운트에서 빠진다. */
  resolved_at: string | null;
  created_at: string;
}

/** audit_logs 1행(회사 소식 피드). */
export interface FeedItem {
  id: string;
  org_id: string;
  actor: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  at: string;
}

/** 뱃지 표시 상태. */
export type BadgeState =
  | { kind: "none" }
  /** 안 본 변화 있음. */
  | { kind: "dot" }
  /** 내가 할 일 n건. display 는 99 초과 시 "99+". */
  | { kind: "count"; count: number; display: string };

/** 패널 탭. */
export const NOTIFY_TABS = { mine: "mine", org: "org" } as const;
export type NotifyTab = (typeof NOTIFY_TABS)[keyof typeof NOTIFY_TABS];

/** 화면별 워터마크(점 계산 기준). */
export interface SurfaceSeen {
  surface_key: SurfaceKey;
  seen_at: string;
}
