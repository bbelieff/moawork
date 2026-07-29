/**
 * 지원/접근위임 저장소 포트 — T08.
 *
 * ⚠ 공용 계약 `@/lib/repo/index.ts` 는 건드리지 않는다(T03 합의 필요).
 *   보드 엔진(`@/lib/boards/store`)과 같은 방식으로 **전용 포트**를 여기 둔다.
 *   로컬 구현: `@/lib/repo/local/supportRepo.ts`. Supabase 연결 시 같은 포트에 어댑터를 끼운다.
 *
 * 이 포트는 **영속성만** 책임진다. 위임 규칙(멤버 읽기전용 고정 · 활성 1건 ·
 * 담당범위 상속 · 홈택스 차단)은 `service.ts` 와 008 마이그레이션이 **양쪽에서** 강제한다.
 */

import type { Ctx } from "@/lib/types";
import type {
  AccessEvent,
  AccessEventAction,
  AccessGrant,
  AccessGrantMode,
  DiagContext,
  SupportMessage,
  SupportNotification,
  SupportNotifyKind,
  SupportThread,
  SupportThreadStatus,
} from "./types";

export interface NewThreadRow {
  org_id: string;
  opened_by: string;
  subject: string;
  diag: DiagContext;
}

export interface NewMessageRow {
  thread_id: string;
  org_id: string;
  author_id: string | null;
  author_kind: SupportMessage["author_kind"];
  body: string;
  attachments?: string[];
}

export interface NewGrantRow {
  org_id: string;
  granted_by: string;
  grantee_admin: string | null;
  reason: string | null;
  mode: AccessGrantMode;
  expires_at: string;
}

export interface NewNotificationRow {
  org_id: string;
  user_id: string;
  kind: SupportNotifyKind;
  thread_id?: string | null;
  grant_id?: string | null;
}

/**
 * 001 `audit_logs` 행의 로컬 미러.
 * Supabase 경로에서는 008 의 RPC 가 진짜 `audit_logs` 에 직접 적재한다.
 */
export interface SupportAuditEntry {
  id: string;
  org_id: string;
  actor: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  meta: Record<string, unknown>;
  at: string;
}

export interface NewAuditEntry {
  org_id: string;
  actor: string | null;
  action: string;
  target_type?: string | null;
  target_id?: string | null;
  meta?: Record<string, unknown>;
}

export interface SupportRepo {
  // ── 문의 스레드 ──
  /** 조직 스코프 목록. 개시자 본인 + owner/admin 만 보인다. */
  listThreads(ctx: Ctx): SupportThread[];
  /** 운영자(플랫폼 관리자) 전용 — 전 조직 문의. 관리자가 아니면 빈 배열. */
  listAllThreads(ctx: Ctx): SupportThread[];
  getThread(ctx: Ctx, id: string): SupportThread | undefined;
  createThread(row: NewThreadRow): SupportThread;
  setThreadStatus(id: string, status: SupportThreadStatus): SupportThread | undefined;

  // ── 메시지 ──
  listMessages(threadId: string): SupportMessage[];
  createMessage(row: NewMessageRow): SupportMessage;

  // ── 알림(뱃지) ──
  listNotifications(userId: string, opts?: { unreadOnly?: boolean }): SupportNotification[];
  createNotification(row: NewNotificationRow): SupportNotification;
  markNotificationsRead(userId: string, ids?: string[]): number;

  // ── 위임 ──
  /** 조직의 모든 위임(최신순). */
  listGrants(orgId: string): AccessGrant[];
  getGrant(id: string): AccessGrant | undefined;
  /** 만료되지 않고 중단되지 않은 위임. 없으면 undefined. */
  findActiveGrant(orgId: string, now?: Date): AccessGrant | undefined;
  createGrant(row: NewGrantRow): AccessGrant;
  revokeGrant(id: string, revokedBy: string, at: string): AccessGrant | undefined;
  /**
   * 만료됐는데 아직 열려 있는 행을 닫는다(revoked_at = expires_at).
   * 008 의 `close_expired_access_grants()` 트리거와 동일 역할.
   * @returns 이번 호출로 **새로 닫힌** 위임들 — 호출측이 만료 기록(소식창·감사로그)을 남긴다.
   */
  closeExpiredGrants(orgId: string, now?: Date): AccessGrant[];

  // ── 감사로그(001 audit_logs 의 로컬 미러 — T08 수명주기 기록용) ──
  listAuditEntries(orgId: string): SupportAuditEntry[];
  createAuditEntry(row: NewAuditEntry): SupportAuditEntry;

  // ── 감사 이벤트(append-only) ──
  listEvents(grantId: string): AccessEvent[];
  createEvent(row: {
    grant_id: string;
    action: AccessEventAction;
    target_table?: string | null;
    target_id?: string | null;
  }): AccessEvent;
}
