import { beforeEach, describe, expect, it } from "vitest";
import type { Ctx, MemberRole, MemberScope } from "@/lib/types";
import { getRepo } from "@/lib/repo";
import { resetDb } from "@/lib/repo/local/store";
import { SEED_ORG_ID, SEED_USER_MEMBER } from "@/lib/repo/local/seed";
import { canReassignDeal } from "./permissions";

beforeEach(() => {
  resetDb();
});

function ctxOf(role: MemberRole, scope: MemberScope): Ctx {
  const repo = getRepo();
  const user = repo.getUser(SEED_USER_MEMBER);
  const org = repo.getOrg(SEED_ORG_ID);
  if (!user || !org) throw new Error("seed 누락");
  return { user, org, role, scope };
}

describe("canReassignDeal — 저장 계층과 같은 규칙이어야 한다", () => {
  it("owner 는 재배정할 수 있다", () => {
    expect(canReassignDeal(ctxOf("owner", "assigned"))).toBe(true);
  });

  it("admin 은 재배정할 수 있다", () => {
    expect(canReassignDeal(ctxOf("admin", "assigned"))).toBe(true);
  });

  it("scope=all 멤버는 재배정할 수 있다", () => {
    expect(canReassignDeal(ctxOf("member", "all"))).toBe(true);
  });

  // ★ 회귀 가드 — 여기가 true 로 넓어지면 무음 실패가 돌아온다.
  // 저장 계층(localRepo·supabaseCrmSource)이 canSeeAll 이 아니면 assigned_to 를
  // 조용히 버리므로, 화면만 열어 주면 «바꿔도 되돌아가고 안내 없음» 이 된다.
  it("scope=assigned 인 일반 멤버는 «본인이 담당자여도» 재배정할 수 없다", () => {
    expect(canReassignDeal(ctxOf("member", "assigned"))).toBe(false);
  });
});

describe("저장 계층이 실제로 값을 버리는지 — 규칙의 근거", () => {
  it("scope=assigned 멤버의 assigned_to 변경은 무시된다(예외 없이)", () => {
    const repo = getRepo();
    const ctx = ctxOf("member", "assigned");
    const deal = repo.listDeals(ctx)[0];
    if (!deal) throw new Error("시드 딜 없음");

    const before = deal.assigned_to;
    const updated = repo.updateDeal(ctx, deal.id, { assigned_to: "usr00000-0000-0000-0000-0000000000a1" });

    // 예외를 던지지 않고 «조용히» 원래 값을 유지한다 — 그래서 화면 게이트가 필요하다.
    expect(updated?.assigned_to).toBe(before);
  });
});
