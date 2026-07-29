/**
 * T08 지원/접근위임 — 수용기준 테스트.
 *
 * 검증 대상(belie 지시 2026-07-28):
 *  - 문의 작성 → 운영자 답변 → 고객 확인 왕복
 *  - 위임 생성·만료·강제종료
 *  - 멤버 개시 위임의 읽기 전용 고정
 *  - 오너 알림 도달
 *  - 감사로그 누락 0
 *  - 홈택스 데이터 차단
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { Ctx, MemberRole, MemberScope } from "@/lib/types";
import { resetDb } from "@/lib/repo/local/store";
import { getRepo } from "@/lib/repo";
import { LocalSupportRepo, resetSupportDb } from "@/lib/repo/local/supportRepo";
import { NoticesService } from "@/lib/notices";
import { SupportForbiddenError, SupportRuleError, SupportService } from "./service";
import { formatRemaining, minutesUntilKstMidnight, resolveDurationMinutes } from "./types";

const ORG = "org-t08";
const OWNER = "user-owner";
const MEMBER = "user-member";
const OPERATOR = "user-operator";

function makeCtx(
  userId: string,
  role: MemberRole,
  scope: MemberScope = "all",
  opts: { orgId?: string; isPlatformAdmin?: boolean } = {},
): Ctx {
  return {
    user: { id: userId, email: `${userId}@example.com`, name: userId, avatar_url: null, created_at: "2026-01-01T00:00:00.000Z" },
    org: { id: opts.orgId ?? ORG, name: "테스트 조직", plan_tier: "t1_3", created_at: "2026-01-01T00:00:00.000Z" },
    role,
    scope,
    isPlatformAdmin: opts.isPlatformAdmin ?? false,
  };
}

/** 소식창(보드 엔진) 부작용 없이 서비스 규칙만 보기 위한 스텁. */
class NoopNotices extends NoticesService {
  override create(): never {
    throw new Error("소식창 미사용(테스트 스텁)");
  }
}

function makeService(): SupportService {
  return new SupportService(new LocalSupportRepo(), new NoopNotices());
}

let ownerCtx: Ctx;
let memberCtx: Ctx;
let operatorCtx: Ctx;
let service: SupportService;

beforeEach(() => {
  resetDb();
  resetSupportDb();
  service = makeService();

  ownerCtx = makeCtx(OWNER, "owner");
  memberCtx = makeCtx(MEMBER, "member", "assigned");
  // 운영자는 **다른 조직** 소속의 플랫폼 관리자다.
  operatorCtx = makeCtx(OPERATOR, "owner", "all", {
    orgId: "org-platform",
    isPlatformAdmin: true,
  });

  // 오너 알림 대상은 공용 repo 의 멤버십에서 읽는다 — 테스트 조직 멤버십을 심어둔다.
  const repo = getRepo();
  const user = (id: string, name: string) => ({
    id,
    email: `${id}@example.com`,
    name,
    avatar_url: null,
    created_at: "2026-01-01T00:00:00.000Z",
  });
  repo.addMember(ORG, user(OWNER, "오너"), "owner", "all");
  repo.addMember(ORG, user(MEMBER, "멤버"), "member", "assigned");
});

// =====================================================================
// 1:1 문의 왕복
// =====================================================================

describe("1:1 문의", () => {
  it("작성 → 운영자 답변 → 고객 확인 왕복이 동작한다", () => {
    const { thread } = service.createThread(ownerCtx, {
      subject: "정산 화면이 안 열려요",
      body: "버튼을 눌러도 반응이 없습니다",
    });
    expect(thread.status).toBe("open");

    // 운영자(다른 조직 플랫폼 관리자)가 답변
    const answer = service.reply(operatorCtx, thread.id, "확인해 보겠습니다");
    expect(answer.author_kind).toBe("operator");

    // 고객 뱃지에 미읽음 1건
    expect(service.unreadCount(ownerCtx)).toBe(1);

    // 고객이 스레드를 확인하면 답변이 보인다
    const seen = service.getThread(ownerCtx, thread.id);
    expect(seen.thread.status).toBe("answered");
    expect(seen.messages.map((m) => m.author_kind)).toEqual(["customer", "operator"]);

    // 고객이 다시 답장
    const back = service.reply(ownerCtx, thread.id, "감사합니다");
    expect(back.author_kind).toBe("customer");
    expect(service.getThread(ownerCtx, thread.id).thread.status).toBe("open");

    // 읽음 처리하면 뱃지가 0
    service.markRead(ownerCtx);
    expect(service.unreadCount(ownerCtx)).toBe(0);
  });

  it("진단 컨텍스트는 화이트리스트만 남기고 고객사명·연락처·금액은 버린다", () => {
    const { thread } = service.createThread(ownerCtx, {
      subject: "문의",
      body: "내용",
      diag: {
        path: "/settlements",
        role: "owner",
        // 화이트리스트 밖 — 저장되면 안 된다.
        company_name: "서울경영지원센터",
        owner_name: "홍길동",
        phone: "010-1234-5678",
        amount: "50000000",
      } as never,
    });

    expect(thread.diag).toEqual({ path: "/settlements", role: "owner" });
    expect(Object.keys(thread.diag)).not.toContain("company_name");
    expect(Object.keys(thread.diag)).not.toContain("owner_name");
    expect(Object.keys(thread.diag)).not.toContain("phone");
    expect(Object.keys(thread.diag)).not.toContain("amount");
  });

  it("플랫폼 관리자가 아니면 남의 조직 스레드에 접근할 수 없다", () => {
    const { thread } = service.createThread(ownerCtx, { subject: "문의", body: "내용" });
    const outsider = makeCtx("user-x", "owner", "all", { orgId: "org-other" });
    expect(() => service.getThread(outsider, thread.id)).toThrow();
  });

  it("운영자 전용 목록은 플랫폼 관리자만 볼 수 있다", () => {
    service.createThread(ownerCtx, { subject: "문의", body: "내용" });
    expect(service.listOperatorThreads(operatorCtx)).toHaveLength(1);
    expect(() => service.listOperatorThreads(ownerCtx)).toThrow(SupportForbiddenError);
  });
});

// =====================================================================
// 위임 수명주기
// =====================================================================

describe("접근위임 수명주기", () => {
  it("오너 승인 없이 즉시 발효하고, 기본 2시간이다", () => {
    const now = new Date("2026-07-28T01:00:00.000Z");
    const grant = service.createGrant(
      ownerCtx,
      { minutes: resolveDurationMinutes("2h", now) },
      now,
    );

    expect(grant.revoked_at).toBeNull();
    expect(new Date(grant.expires_at).getTime() - now.getTime()).toBe(120 * 60_000);
    expect(service.activeGrant(ownerCtx, now)?.id).toBe(grant.id);
  });

  it("만료되면 자동으로 닫히고 활성 위임이 사라진다", () => {
    const start = new Date("2026-07-28T01:00:00.000Z");
    const grant = service.createGrant(ownerCtx, { minutes: 30 }, start);

    const during = new Date(start.getTime() + 10 * 60_000);
    expect(service.activeGrant(ownerCtx, during)?.id).toBe(grant.id);

    const after = new Date(start.getTime() + 31 * 60_000);
    expect(service.activeGrant(ownerCtx, after)).toBeNull();

    const closed = service.listGrants(ownerCtx).find((g) => g.id === grant.id);
    expect(closed?.revoked_at).toBe(grant.expires_at);
  });

  it("강제 종료하면 즉시 비활성이 된다", () => {
    const now = new Date("2026-07-28T01:00:00.000Z");
    const grant = service.createGrant(ownerCtx, { minutes: 120 }, now);

    const revoked = service.revokeGrant(ownerCtx, grant.id, now);
    expect(revoked.revoked_at).not.toBeNull();
    expect(revoked.revoked_by).toBe(OWNER);
    expect(service.activeGrant(ownerCtx, now)).toBeNull();
  });

  it("회사당 활성 위임은 1건으로 제한된다", () => {
    const now = new Date("2026-07-28T01:00:00.000Z");
    service.createGrant(ownerCtx, { minutes: 120 }, now);
    expect(() => service.createGrant(ownerCtx, { minutes: 30 }, now)).toThrow(
      SupportRuleError,
    );
  });

  it("만료된 위임은 새 위임을 막지 않는다", () => {
    const start = new Date("2026-07-28T01:00:00.000Z");
    service.createGrant(ownerCtx, { minutes: 30 }, start);

    const later = new Date(start.getTime() + 31 * 60_000);
    const second = service.createGrant(ownerCtx, { minutes: 30 }, later);
    expect(second.revoked_at).toBeNull();
  });

  it("24시간을 넘는 위임은 거부한다", () => {
    expect(() => service.createGrant(ownerCtx, { minutes: 1441 })).toThrow(
      SupportRuleError,
    );
  });
});

// =====================================================================
// 멤버 개시 위임 = 읽기 전용 고정
// =====================================================================

describe("멤버 개시 위임", () => {
  it("멤버가 write 를 요청해도 읽기 전용으로 고정된다", () => {
    const grant = service.createGrant(memberCtx, { minutes: 120, mode: "write" });
    expect(grant.mode).toBe("read");
  });

  it("오너·관리자는 보기+고치기를 선택할 수 있다", () => {
    expect(service.createGrant(ownerCtx, { minutes: 120, mode: "write" }).mode).toBe(
      "write",
    );
    resetSupportDb();
    const adminCtx = makeCtx("user-admin", "admin");
    expect(service.createGrant(adminCtx, { minutes: 120, mode: "write" }).mode).toBe(
      "write",
    );
  });

  it("읽기 전용 위임으로는 update 이벤트를 남길 수 없다", () => {
    const grant = service.createGrant(memberCtx, { minutes: 120, mode: "write" });
    expect(() => service.logEvent(operatorCtx, grant.id, "update")).toThrow(
      SupportForbiddenError,
    );
    // 보기(view)는 정상 기록된다.
    expect(service.logEvent(operatorCtx, grant.id, "view").action).toBe("view");
  });

  it("멤버는 자기 위임만 종료할 수 있다", () => {
    const ownerGrant = service.createGrant(ownerCtx, { minutes: 120 });
    expect(() => service.revokeGrant(memberCtx, ownerGrant.id)).toThrow(
      SupportForbiddenError,
    );

    // 오너가 닫아준 뒤 멤버가 자기 위임을 열고 닫는 건 된다.
    service.revokeGrant(ownerCtx, ownerGrant.id);
    const own = service.createGrant(memberCtx, { minutes: 120 });
    expect(service.revokeGrant(memberCtx, own.id).revoked_at).not.toBeNull();
  });

  it("오너는 멤버가 연 위임을 강제 종료할 수 있다", () => {
    const grant = service.createGrant(memberCtx, { minutes: 120 });
    expect(service.revokeGrant(ownerCtx, grant.id).revoked_by).toBe(OWNER);
  });
});

// =====================================================================
// 감사로그 · 오너 알림
// =====================================================================

describe("감사로그와 알림", () => {
  it("생성·중단·만료가 모두 감사로그에 남는다(누락 0)", () => {
    const start = new Date("2026-07-28T01:00:00.000Z");

    const a = service.createGrant(ownerCtx, { minutes: 30 }, start);
    service.revokeGrant(ownerCtx, a.id, new Date(start.getTime() + 60_000));

    const b = service.createGrant(ownerCtx, { minutes: 30 }, new Date(start.getTime() + 120_000));
    // b 를 만료시킨다
    service.activeGrant(ownerCtx, new Date(start.getTime() + 40 * 60_000));

    const actions = service.listAudit(ownerCtx).map((e) => e.action);
    expect(actions.filter((x) => x === "access_grant.created")).toHaveLength(2);
    expect(actions.filter((x) => x === "access_grant.revoked")).toHaveLength(1);
    expect(actions.filter((x) => x === "access_grant.expired")).toHaveLength(1);

    // 모든 감사 항목이 대상 위임을 가리킨다
    for (const entry of service.listAudit(ownerCtx)) {
      expect(entry.target_type).toBe("access_grants");
      expect([a.id, b.id]).toContain(entry.target_id);
    }
  });

  it("멤버가 위임을 열면 오너에게 알림이 간다", () => {
    service.createGrant(memberCtx, { minutes: 120 });

    const inbox = service.listNotifications(ownerCtx, { unreadOnly: true });
    expect(inbox.map((n) => n.kind)).toContain("grant_started");
    expect(service.unreadCount(ownerCtx)).toBeGreaterThan(0);
  });

  it("수임자 행위는 append-only 감사 이벤트로 쌓인다", () => {
    const grant = service.createGrant(ownerCtx, { minutes: 120 });
    service.logEvent(operatorCtx, grant.id, "view", { table: "deals", id: null });
    service.logEvent(operatorCtx, grant.id, "download", { table: "boards", id: null });

    const events = service.listEvents(ownerCtx, grant.id);
    expect(events.map((e) => e.action)).toEqual(["view", "download"]);
    expect(events[0].target_table).toBe("deals");
  });

  it("만료·중단된 위임으로는 행위를 기록할 수 없다", () => {
    const now = new Date("2026-07-28T01:00:00.000Z");
    const grant = service.createGrant(ownerCtx, { minutes: 120 }, now);
    service.revokeGrant(ownerCtx, grant.id, now);
    expect(() => service.logEvent(operatorCtx, grant.id, "view")).toThrow(
      SupportForbiddenError,
    );
  });
});

// =====================================================================
// 홈택스 차단
// =====================================================================

describe("홈택스 차단", () => {
  it("위임이 살아 있어도 홈택스 테이블은 열리지 않는다", () => {
    const grant = service.createGrant(ownerCtx, { minutes: 120, mode: "write" });

    for (const table of ["hometax_consents", "hometax_docs"]) {
      expect(() =>
        service.logEvent(operatorCtx, grant.id, "view", { table, id: null }),
      ).toThrow(SupportForbiddenError);
    }

    // 업무 테이블은 정상 통과 — 차단이 전체 차단이 아니라 홈택스 한정임을 확인.
    expect(
      service.logEvent(operatorCtx, grant.id, "view", { table: "deals", id: null }).action,
    ).toBe("view");
  });
});

// =====================================================================
// 표시 유틸
// =====================================================================

describe("표시 유틸", () => {
  it("남은 시간 문구는 배너 사양대로 만든다", () => {
    expect(formatRemaining(102 * 60_000)).toBe("1시간 42분");
    expect(formatRemaining(8 * 60_000)).toBe("8분");
    expect(formatRemaining(120 * 60_000)).toBe("2시간");
    expect(formatRemaining(0)).toBe("0분");
  });

  it("'오늘 안' 은 KST 자정까지이고 24시간을 넘지 않는다", () => {
    // 2026-07-28T01:00Z = KST 10:00 → 자정까지 14시간(840분)
    expect(minutesUntilKstMidnight(new Date("2026-07-28T01:00:00.000Z"))).toBe(840);
    const any = minutesUntilKstMidnight(new Date("2026-07-28T15:30:00.000Z"));
    expect(any).toBeGreaterThan(0);
    expect(any).toBeLessThanOrEqual(1440);
  });

  it("기간 프리셋이 분으로 정확히 풀린다", () => {
    expect(resolveDurationMinutes("30m")).toBe(30);
    expect(resolveDurationMinutes("2h")).toBe(120);
    expect(resolveDurationMinutes("없는값")).toBe(120);
  });
});
