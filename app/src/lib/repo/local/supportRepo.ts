/**
 * 지원/접근위임 — 로컬(인메모리) 어댑터. (T08)
 * 포트: `@/lib/support/store`. Supabase 연결 후 SupabaseSupportRepo 로 교체.
 *
 * 저장은 **자체 슬롯**(globalThis.__moaworkSupportDb)을 쓴다.
 * 공용 `Db`(repo/local/store.ts)는 T02/T03 소유라 확장하지 않는다(경계 존중).
 */

import type { Ctx } from "@/lib/types";
import { isManager } from "@/lib/auth/roles";
import type {
  NewAuditEntry,
  NewGrantRow,
  NewMessageRow,
  NewNotificationRow,
  NewThreadRow,
  SupportAuditEntry,
  SupportRepo,
} from "@/lib/support/store";
import type {
  AccessEvent,
  AccessEventAction,
  AccessGrant,
  SupportMessage,
  SupportNotification,
  SupportThread,
  SupportThreadStatus,
} from "@/lib/support/types";
import { isGrantActive } from "@/lib/support/types";

interface SupportDb {
  threads: SupportThread[];
  messages: SupportMessage[];
  notifications: SupportNotification[];
  grants: AccessGrant[];
  events: AccessEvent[];
  auditLogs: SupportAuditEntry[];
}

const globalSupport = globalThis as unknown as { __moaworkSupportDb?: SupportDb };

export function supportDb(): SupportDb {
  if (!globalSupport.__moaworkSupportDb) {
    globalSupport.__moaworkSupportDb = {
      threads: [],
      messages: [],
      notifications: [],
      grants: [],
      events: [],
      auditLogs: [],
    };
  }
  return globalSupport.__moaworkSupportDb;
}

/** 테스트용 초기화. */
export function resetSupportDb(): void {
  globalSupport.__moaworkSupportDb = undefined;
}

function now(): string {
  return new Date().toISOString();
}

function desc(a: string, b: string): number {
  return a < b ? 1 : a > b ? -1 : 0;
}

export class LocalSupportRepo implements SupportRepo {
  // ── 문의 스레드 ──

  listThreads(ctx: Ctx): SupportThread[] {
    return supportDb()
      .threads.filter(
        (t) =>
          t.org_id === ctx.org.id &&
          (isManager(ctx.role) || t.opened_by === ctx.user.id),
      )
      .sort((a, b) => desc(a.last_message_at, b.last_message_at));
  }

  listAllThreads(ctx: Ctx): SupportThread[] {
    if (!ctx.isPlatformAdmin) return [];
    return [...supportDb().threads].sort((a, b) =>
      desc(a.last_message_at, b.last_message_at),
    );
  }

  getThread(ctx: Ctx, id: string): SupportThread | undefined {
    const thread = supportDb().threads.find((t) => t.id === id);
    if (!thread) return undefined;
    if (ctx.isPlatformAdmin) return thread;
    if (thread.org_id !== ctx.org.id) return undefined;
    if (isManager(ctx.role) || thread.opened_by === ctx.user.id) return thread;
    return undefined;
  }

  createThread(row: NewThreadRow): SupportThread {
    const ts = now();
    const thread: SupportThread = {
      id: crypto.randomUUID(),
      org_id: row.org_id,
      opened_by: row.opened_by,
      subject: row.subject,
      status: "open",
      diag: row.diag,
      created_at: ts,
      updated_at: ts,
      last_message_at: ts,
    };
    supportDb().threads.push(thread);
    return thread;
  }

  setThreadStatus(id: string, status: SupportThreadStatus): SupportThread | undefined {
    const thread = supportDb().threads.find((t) => t.id === id);
    if (!thread) return undefined;
    thread.status = status;
    thread.updated_at = now();
    return thread;
  }

  // ── 메시지 ──

  listMessages(threadId: string): SupportMessage[] {
    return supportDb()
      .messages.filter((m) => m.thread_id === threadId)
      .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  }

  createMessage(row: NewMessageRow): SupportMessage {
    const ts = now();
    const message: SupportMessage = {
      id: crypto.randomUUID(),
      thread_id: row.thread_id,
      org_id: row.org_id,
      author_id: row.author_id,
      author_kind: row.author_kind,
      body: row.body,
      attachments: row.attachments ?? [],
      created_at: ts,
    };
    supportDb().messages.push(message);

    const thread = supportDb().threads.find((t) => t.id === row.thread_id);
    if (thread) {
      thread.last_message_at = ts;
      thread.updated_at = ts;
    }
    return message;
  }

  // ── 알림 ──

  listNotifications(
    userId: string,
    opts: { unreadOnly?: boolean } = {},
  ): SupportNotification[] {
    return supportDb()
      .notifications.filter(
        (n) => n.user_id === userId && (!opts.unreadOnly || n.read_at === null),
      )
      .sort((a, b) => desc(a.created_at, b.created_at));
  }

  createNotification(row: NewNotificationRow): SupportNotification {
    const notification: SupportNotification = {
      id: crypto.randomUUID(),
      org_id: row.org_id,
      user_id: row.user_id,
      kind: row.kind,
      thread_id: row.thread_id ?? null,
      grant_id: row.grant_id ?? null,
      created_at: now(),
      read_at: null,
    };
    supportDb().notifications.push(notification);
    return notification;
  }

  markNotificationsRead(userId: string, ids?: string[]): number {
    const ts = now();
    let count = 0;
    for (const n of supportDb().notifications) {
      if (n.user_id !== userId || n.read_at !== null) continue;
      if (ids && !ids.includes(n.id)) continue;
      n.read_at = ts;
      count += 1;
    }
    return count;
  }

  // ── 위임 ──

  listGrants(orgId: string): AccessGrant[] {
    return supportDb()
      .grants.filter((g) => g.org_id === orgId)
      .sort((a, b) => desc(a.granted_at, b.granted_at));
  }

  getGrant(id: string): AccessGrant | undefined {
    return supportDb().grants.find((g) => g.id === id);
  }

  findActiveGrant(orgId: string, at: Date = new Date()): AccessGrant | undefined {
    return supportDb().grants.find((g) => g.org_id === orgId && isGrantActive(g, at));
  }

  createGrant(row: NewGrantRow): AccessGrant {
    const grant: AccessGrant = {
      id: crypto.randomUUID(),
      org_id: row.org_id,
      granted_by: row.granted_by,
      grantee_admin: row.grantee_admin,
      reason: row.reason,
      mode: row.mode,
      granted_at: now(),
      expires_at: row.expires_at,
      revoked_at: null,
      revoked_by: null,
    };
    supportDb().grants.push(grant);
    return grant;
  }

  revokeGrant(id: string, revokedBy: string, at: string): AccessGrant | undefined {
    const grant = supportDb().grants.find((g) => g.id === id);
    if (!grant) return undefined;
    if (grant.revoked_at !== null) return grant;
    grant.revoked_at = at;
    grant.revoked_by = revokedBy;
    return grant;
  }

  /**
   * 만료됐는데 아직 열려 있는 행을 닫는다(revoked_at = expires_at).
   * 008 의 `close_expired_access_grants()` 트리거와 같은 일 — "활성 1건" 판정이
   * 만료 위임 때문에 막히지 않게 한다.
   */
  closeExpiredGrants(orgId: string, at: Date = new Date()): AccessGrant[] {
    const closed: AccessGrant[] = [];
    for (const g of supportDb().grants) {
      if (g.org_id !== orgId || g.revoked_at !== null) continue;
      if (new Date(g.expires_at).getTime() > at.getTime()) continue;
      g.revoked_at = g.expires_at;
      closed.push(g);
    }
    return closed;
  }

  // ── 감사로그(001 audit_logs 로컬 미러) ──

  listAuditEntries(orgId: string): SupportAuditEntry[] {
    return supportDb()
      .auditLogs.filter((a) => a.org_id === orgId)
      .sort((a, b) => desc(a.at, b.at));
  }

  createAuditEntry(row: NewAuditEntry): SupportAuditEntry {
    const entry: SupportAuditEntry = {
      id: crypto.randomUUID(),
      org_id: row.org_id,
      actor: row.actor,
      action: row.action,
      target_type: row.target_type ?? null,
      target_id: row.target_id ?? null,
      meta: row.meta ?? {},
      at: now(),
    };
    supportDb().auditLogs.push(entry);
    return entry;
  }

  // ── 감사 이벤트(append-only — 갱신/삭제 메서드를 두지 않는다) ──

  listEvents(grantId: string): AccessEvent[] {
    return supportDb()
      .events.filter((e) => e.grant_id === grantId)
      .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  }

  createEvent(row: {
    grant_id: string;
    action: AccessEventAction;
    target_table?: string | null;
    target_id?: string | null;
  }): AccessEvent {
    const event: AccessEvent = {
      id: crypto.randomUUID(),
      grant_id: row.grant_id,
      at: now(),
      action: row.action,
      target_table: row.target_table ?? null,
      target_id: row.target_id ?? null,
    };
    supportDb().events.push(event);
    return event;
  }
}

const globalRepo = globalThis as unknown as { __moaworkSupportRepo?: SupportRepo };

export function getSupportRepo(): SupportRepo {
  if (!globalRepo.__moaworkSupportRepo) {
    globalRepo.__moaworkSupportRepo = new LocalSupportRepo();
  }
  return globalRepo.__moaworkSupportRepo;
}
