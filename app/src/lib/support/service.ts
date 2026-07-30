/**
 * 지원(1:1 문의) + 접근위임 서비스 — T08.
 *
 * 여기 규칙은 `supabase/migrations/017_support_access_delegation.sql` 과 **쌍둥이**다.
 * DB 가 최종 방어선이고, 이 계층은 로컬 런타임과 API 응답 문구를 담당한다.
 * 둘 중 하나만 고치면 안 된다.
 *
 * 불변식(belie 확정 2026-07-28):
 *  1) 오너 승인 불필요 — 멤버도 직접 위임하며 **즉시 발효**한다.
 *  2) 멤버가 개시한 위임은 **읽기 전용 고정**(mode='write' 는 owner/admin 만).
 *  3) 회사당 활성 위임 **1건**.
 *  4) scope='assigned' 멤버가 개시하면 수임자도 **그 멤버 담당 건만** 본다.
 *  5) 위임 즉시 **오너에게 알림**. 오너는 언제든 강제 종료, 멤버는 자기 것만 종료.
 *  6) 홈택스 데이터는 **위임 중에도 항상 차단**.
 *  7) 만료·중단·종료는 **소식창 + 감사로그**에 남긴다.
 */

import type { Ctx } from "@/lib/types";
import { isManager, roleLabel } from "@/lib/auth/roles";
import { getRepo } from "@/lib/repo";
import { getNoticesService, NoticesService } from "@/lib/notices";
import { getSupportRepo } from "@/lib/repo/local/supportRepo";
import type { SupportAuditEntry, SupportRepo } from "./store";
import {
  DIAG_KEYS,
  MAX_GRANT_MINUTES,
  formatRemaining,
  grantRemainingMs,
  isGrantActive,
  type AccessEvent,
  type AccessEventAction,
  type AccessGrant,
  type AccessGrantMode,
  type DiagContext,
  type NewAccessGrant,
  type NewSupportThread,
  type SupportMessage,
  type SupportNotification,
  type SupportThread,
} from "./types";

export class SupportRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupportRuleError";
  }
}

export class SupportNotFoundError extends Error {
  constructor(message = "찾을 수 없습니다") {
    super(message);
    this.name = "SupportNotFoundError";
  }
}

export class SupportForbiddenError extends Error {
  constructor(message = "권한이 없습니다") {
    super(message);
    this.name = "SupportForbiddenError";
  }
}

/**
 * 위임으로도 절대 열리지 않는 테이블 — 홈택스 위임동의·수집서류(재수탁 개인정보).
 * 008 의 RESTRICTIVE 정책(`htconsent_no_grant` / `htdocs_no_grant`)과 같은 목록.
 */
export const GRANT_BLOCKED_TABLES: readonly string[] = [
  "hometax_consents",
  "hometax_docs",
] as const;

/** 위임 범위에서 이 테이블을 열 수 있는가. */
export function isGrantReadable(table: string): boolean {
  return !GRANT_BLOCKED_TABLES.includes(table);
}

/**
 * 진단 컨텍스트를 화이트리스트로 걸러낸다.
 * 고객사명·대표자명·연락처·금액 등 화이트리스트 밖 키는 **조용히 버린다**
 * (에러를 내면 클라이언트가 우회 문자열로 밀어 넣을 유인이 생긴다).
 */
export function sanitizeDiag(raw: unknown): DiagContext {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const input = raw as Record<string, unknown>;
  const out: DiagContext = {};
  for (const key of DIAG_KEYS) {
    const value = input[key];
    if (typeof value === "string" && value !== "") out[key] = value.slice(0, 300);
  }
  return out;
}

export class SupportService {
  constructor(
    private readonly repo: SupportRepo = getSupportRepo(),
    private readonly notices: NoticesService = getNoticesService(),
  ) {}

  // =====================================================================
  // 1:1 문의
  // =====================================================================

  listThreads(ctx: Ctx): SupportThread[] {
    return this.repo.listThreads(ctx);
  }

  /** 운영자 화면(/platform/지원) — 전 조직 문의. 플랫폼 관리자가 아니면 거부. */
  listOperatorThreads(ctx: Ctx): SupportThread[] {
    if (!ctx.isPlatformAdmin) throw new SupportForbiddenError("운영자 전용 화면입니다");
    return this.repo.listAllThreads(ctx);
  }

  getThread(ctx: Ctx, id: string): { thread: SupportThread; messages: SupportMessage[] } {
    const thread = this.repo.getThread(ctx, id);
    if (!thread) throw new SupportNotFoundError("문의를 찾을 수 없습니다");
    return { thread, messages: this.repo.listMessages(thread.id) };
  }

  createThread(ctx: Ctx, input: NewSupportThread): {
    thread: SupportThread;
    message: SupportMessage;
  } {
    const subject = input.subject.trim();
    const body = input.body.trim();
    if (subject === "") throw new SupportRuleError("제목을 입력하세요");
    if (body === "") throw new SupportRuleError("내용을 입력하세요");

    const thread = this.repo.createThread({
      org_id: ctx.org.id,
      opened_by: ctx.user.id,
      subject,
      diag: sanitizeDiag(input.diag ?? {}),
    });
    const message = this.repo.createMessage({
      thread_id: thread.id,
      org_id: ctx.org.id,
      author_id: ctx.user.id,
      author_kind: "customer",
      body,
    });
    return { thread, message };
  }

  /**
   * 답변/추가 문의.
   * 운영자(플랫폼 관리자)가 쓰면 개시자에게 미읽음 알림이 쌓인다(뱃지 숫자).
   */
  reply(ctx: Ctx, threadId: string, body: string): SupportMessage {
    const text = body.trim();
    if (text === "") throw new SupportRuleError("내용을 입력하세요");

    const thread = this.repo.getThread(ctx, threadId);
    if (!thread) throw new SupportNotFoundError("문의를 찾을 수 없습니다");
    if (thread.status === "closed") throw new SupportRuleError("종료된 문의입니다");

    // 작성자 축 판정: 그 조직 안에서 쓰면 고객, 조직 밖(플랫폼 관리자)에서 쓰면 운영자.
    // 플랫폼 관리자가 자기 조직 문의에 쓰는 경우는 고객으로 잡히는 게 맞다.
    const kind: SupportMessage["author_kind"] =
      thread.org_id === ctx.org.id ? "customer" : "operator";
    if (kind === "operator" && ctx.isPlatformAdmin !== true) {
      throw new SupportForbiddenError("이 문의에 답할 권한이 없습니다");
    }

    const message = this.repo.createMessage({
      thread_id: thread.id,
      org_id: thread.org_id,
      author_id: ctx.user.id,
      author_kind: kind,
      body: text,
    });

    if (kind === "operator") {
      this.repo.setThreadStatus(thread.id, "answered");
      if (thread.opened_by !== ctx.user.id) {
        this.repo.createNotification({
          org_id: thread.org_id,
          user_id: thread.opened_by,
          kind: "support_reply",
          thread_id: thread.id,
        });
      }
    } else {
      this.repo.setThreadStatus(thread.id, "open");
    }
    return message;
  }

  closeThread(ctx: Ctx, threadId: string): SupportThread {
    const thread = this.repo.getThread(ctx, threadId);
    if (!thread) throw new SupportNotFoundError("문의를 찾을 수 없습니다");
    const closed = this.repo.setThreadStatus(thread.id, "closed");
    if (!closed) throw new SupportNotFoundError("문의를 찾을 수 없습니다");
    return closed;
  }

  // =====================================================================
  // 알림(뱃지)
  // =====================================================================

  listNotifications(ctx: Ctx, opts: { unreadOnly?: boolean } = {}): SupportNotification[] {
    return this.repo.listNotifications(ctx.user.id, opts);
  }

  /** 플로팅 버튼 뱃지 숫자 = 내가 볼 일(미읽음 답변 + 위임 알림). */
  unreadCount(ctx: Ctx): number {
    // 만료분을 먼저 정리해야 만료 알림이 최신 상태로 잡힌다.
    this.sweepExpired(ctx);
    return this.repo.listNotifications(ctx.user.id, { unreadOnly: true }).length;
  }

  /** 명시적으로 지정한 알림만 읽음 처리한다. */
  markRead(ctx: Ctx, ids?: string[]): number {
    return this.repo.markNotificationsRead(ctx.user.id, { ids });
  }

  /**
   * 문의 목록을 열었을 때의 읽음 처리 — **답변 알림만** 지운다.
   *
   * 위임 알림(`grant_started`)은 오너가 "강제 종료할지" 판단해야 하는 **행동 항목**이라
   * 화면 진입만으로 사라지면 안 된다(T06 mod.notify 의 "봤다 ≠ 했다" 계약).
   * 위임 알림은 위임이 실제로 끝날 때만 정리된다.
   */
  markThreadsRead(ctx: Ctx): number {
    return this.repo.markNotificationsRead(ctx.user.id, {
      kinds: ["support_reply"],
    });
  }

  // =====================================================================
  // 접근위임
  // =====================================================================

  /**
   * 현재 살아 있는 위임. 조회할 때마다 만료분을 정리하고 만료 기록을 남긴다
   * (배너·뱃지가 만료를 즉시 반영하도록 — 별도 스케줄러 없이).
   */
  activeGrant(ctx: Ctx, now: Date = new Date()): AccessGrant | null {
    this.sweepExpired(ctx, now);
    return this.repo.findActiveGrant(ctx.org.id, now) ?? null;
  }

  /**
   * 운영자용 — 특정 조직의 활성 위임 상태. 플랫폼 관리자만.
   * 조회만 한다(운영자는 위임을 스스로 열 수 없다 — 고객이 여는 것이 기본 경로).
   */
  activeGrantForOrg(ctx: Ctx, orgId: string, now: Date = new Date()): AccessGrant | null {
    if (!ctx.isPlatformAdmin) throw new SupportForbiddenError("운영자 전용입니다");
    this.repo.closeExpiredGrants(orgId, now);
    return this.repo.findActiveGrant(orgId, now) ?? null;
  }

  listGrants(ctx: Ctx): AccessGrant[] {
    this.sweepExpired(ctx);
    return this.repo.listGrants(ctx.org.id);
  }

  /**
   * 위임 개시 — **오너 승인 없이 즉시 발효**.
   * 대신 멤버 개시분은 읽기 전용으로 고정하고, 활성 1건 제한을 건다.
   */
  createGrant(ctx: Ctx, input: NewAccessGrant, now: Date = new Date()): AccessGrant {
    const minutes = Math.trunc(input.minutes);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      throw new SupportRuleError("위임 기간을 선택하세요");
    }
    if (minutes > MAX_GRANT_MINUTES) {
      throw new SupportRuleError("위임은 최대 24시간까지 가능합니다");
    }

    // 불변식 2 — 멤버가 고른 "보기+고치기"는 여기서 읽기 전용으로 되돌린다.
    const requested: AccessGrantMode = input.mode ?? "read";
    const mode: AccessGrantMode = isManager(ctx.role) ? requested : "read";

    // 불변식 3 — 만료분을 닫은 뒤에도 살아 있는 위임이 있으면 거부.
    this.sweepExpired(ctx, now);
    if (this.repo.findActiveGrant(ctx.org.id, now)) {
      throw new SupportRuleError(
        "이미 열려 있는 위임이 있습니다. 먼저 중단한 뒤 다시 열어주세요",
      );
    }

    const reason = input.reason?.trim() ?? "";
    const grant = this.repo.createGrant({
      org_id: ctx.org.id,
      granted_by: ctx.user.id,
      grantee_admin: input.grantee_admin ?? null,
      reason: reason === "" ? null : reason,
      mode,
      expires_at: new Date(now.getTime() + minutes * 60_000).toISOString(),
    });

    this.notifyOwners(ctx, grant, "grant_started");
    this.audit(ctx, grant, "access_grant.created", {
      mode: grant.mode,
      expires_at: grant.expires_at,
      reason: grant.reason,
      requested_mode: requested,
      pinned_readonly: requested !== mode,
    });
    this.postNotice(
      ctx,
      "🔓 화면 보기 권한이 열렸습니다",
      [
        `${ctx.user.name ?? "멤버"}(${roleLabel(ctx.role)})님이 운영자에게 화면을 열었습니다.`,
        `범위: ${mode === "write" ? "보기+고치기" : "보기만"}`,
        `만료 예정: ${grant.expires_at}`,
        grant.reason ? `사유: ${grant.reason}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    );

    return grant;
  }

  /**
   * 위임 종료(강제 중단).
   * owner/admin 은 어떤 위임이든, 멤버는 **자기가 개시한 위임만** 종료할 수 있다.
   */
  revokeGrant(ctx: Ctx, grantId: string, now: Date = new Date()): AccessGrant {
    const grant = this.repo.getGrant(grantId);
    if (!grant || grant.org_id !== ctx.org.id) {
      throw new SupportNotFoundError("위임을 찾을 수 없습니다");
    }
    if (!isManager(ctx.role) && grant.granted_by !== ctx.user.id) {
      throw new SupportForbiddenError("자기가 개시한 위임만 종료할 수 있습니다");
    }
    if (!isGrantActive(grant, now)) return grant;

    const revoked = this.repo.revokeGrant(grantId, ctx.user.id, now.toISOString());
    if (!revoked) throw new SupportNotFoundError("위임을 찾을 수 없습니다");

    this.notifyOwners(ctx, revoked, "grant_ended");
    this.audit(ctx, revoked, "access_grant.revoked", {
      revoked_at: revoked.revoked_at,
      by: ctx.user.id,
    });
    this.postNotice(
      ctx,
      "🔒 화면 보기 권한이 중단되었습니다",
      `${ctx.user.name ?? "멤버"}님이 운영자 접근을 중단했습니다.`,
    );
    return revoked;
  }

  // ── 감사 이벤트 ──

  listEvents(ctx: Ctx, grantId: string): AccessEvent[] {
    const grant = this.repo.getGrant(grantId);
    if (!grant) throw new SupportNotFoundError("위임을 찾을 수 없습니다");
    const visible = grant.org_id === ctx.org.id || ctx.isPlatformAdmin === true;
    if (!visible) throw new SupportForbiddenError();
    return this.repo.listEvents(grantId);
  }

  /**
   * 수임자 행위 기록 — 감사로그 누락 0의 핵심.
   * 홈택스 테이블은 여기서도 거부한다(기록조차 남기지 않고 접근 자체를 막는다).
   */
  logEvent(
    ctx: Ctx,
    grantId: string,
    action: AccessEventAction,
    target?: { table?: string | null; id?: string | null },
  ): AccessEvent {
    const grant = this.repo.getGrant(grantId);
    if (!grant) throw new SupportNotFoundError("위임을 찾을 수 없습니다");

    const table = target?.table ?? null;
    if (table !== null && !isGrantReadable(table)) {
      throw new SupportForbiddenError(
        "홈택스 위임·수집 서류는 접근 위임 범위에서 제외됩니다",
      );
    }
    if (action === "update" && grant.mode !== "write") {
      throw new SupportForbiddenError("보기 전용 위임입니다");
    }
    if (!isGrantActive(grant)) {
      throw new SupportForbiddenError("만료되었거나 중단된 위임입니다");
    }

    return this.repo.createEvent({
      grant_id: grantId,
      action,
      target_table: table,
      target_id: target?.id ?? null,
    });
  }

  /** 감사로그(수명주기) 조회 — 검증·보고용. */
  listAudit(ctx: Ctx): SupportAuditEntry[] {
    return this.repo.listAuditEntries(ctx.org.id);
  }

  // =====================================================================
  // 내부
  // =====================================================================

  /** 만료된 활성 위임을 닫고, 만료 사실을 소식창·감사로그·오너 알림에 남긴다. */
  private sweepExpired(ctx: Ctx, now: Date = new Date()): void {
    const closed = this.repo.closeExpiredGrants(ctx.org.id, now);
    for (const grant of closed) {
      this.notifyOwners(ctx, grant, "grant_ended");
      this.audit(ctx, grant, "access_grant.expired", { expires_at: grant.expires_at });
      this.postNotice(
        ctx,
        "🔒 화면 보기 권한이 만료되었습니다",
        `${grant.expires_at} 에 운영자 접근이 자동으로 닫혔습니다.`,
      );
    }
  }

  private notifyOwners(
    ctx: Ctx,
    grant: AccessGrant,
    kind: "grant_started" | "grant_ended",
  ): void {
    const owners = getRepo()
      .listMembers(grant.org_id)
      .filter((m) => m.role === "owner" && m.user_id !== ctx.user.id);
    for (const owner of owners) {
      this.repo.createNotification({
        org_id: grant.org_id,
        user_id: owner.user_id,
        kind,
        grant_id: grant.id,
      });
    }
  }

  private audit(
    ctx: Ctx,
    grant: AccessGrant,
    action: string,
    meta: Record<string, unknown>,
  ): void {
    this.repo.createAuditEntry({
      org_id: grant.org_id,
      actor: ctx.user.id,
      action,
      target_type: "access_grants",
      target_id: grant.id,
      meta,
    });
  }

  /**
   * 소식창(회사 소식) 기록. 소식창은 T04 가 003 보드 엔진 위에 올린 것이라
   * 여기서는 NoticesService 만 호출한다(저장 구조에 직접 의존하지 않는다).
   * 소식창 기록 실패가 위임 자체를 실패시키면 안 되므로 삼킨다 — 감사로그가 정본이다.
   */
  private postNotice(ctx: Ctx, title: string, body: string): void {
    try {
      this.notices.create(ctx, { title, body, categoryId: "notice-important" });
    } catch {
      // 소식창 기록 실패는 위임 수명주기를 막지 않는다.
    }
  }
}

const globalService = globalThis as unknown as { __moaworkSupportService?: SupportService };

export function getSupportService(): SupportService {
  if (!globalService.__moaworkSupportService) {
    globalService.__moaworkSupportService = new SupportService();
  }
  return globalService.__moaworkSupportService;
}

/** 배너 문구 — `🔓 운영자가 보고 있어요 · 남은 시간 1시간 42분`. */
export function grantBannerText(grant: AccessGrant, now: Date = new Date()): string {
  return `🔓 운영자가 보고 있어요 · 남은 시간 ${formatRemaining(grantRemainingMs(grant, now))}`;
}
