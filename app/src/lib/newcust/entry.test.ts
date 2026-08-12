import { beforeEach, describe, expect, it } from "vitest";
import type { Ctx } from "@/lib/types";
import { getBoardsRepo } from "@/lib/repo/local/boardsRepo";
import { resetDb } from "@/lib/repo/local/store";
import { SEED_ORG_ID, SEED_USER_OWNER } from "@/lib/repo/local/seed";
import { resolveExistingNewcustBoard } from "./entry";

function owner(): Ctx {
  return {
    user: { id: SEED_USER_OWNER, email: "owner@example.test", name: "owner", avatar_url: null, created_at: "" },
    org: { id: SEED_ORG_ID, name: "example", plan_tier: "t1_3", created_at: "" },
    role: "owner",
    scope: "all",
  } as Ctx;
}

beforeEach(() => resetDb());

describe("resolveExistingNewcustBoard", () => {
  it("제품 경로에서 이름이 같은 보드를 먼데이 원본으로 추론하지 않는다", () => {
    const ctx = owner();
    const repo = getBoardsRepo();
    repo.createBoard(ctx, { name: "🔥신규고객" });
    expect(resolveExistingNewcustBoard(ctx, repo)).toEqual({ kind: "missing" });
  });

  it("이름이 같은 보드가 여럿이어도 이관 대상을 임의 선택하지 않는다", () => {
    const ctx = owner();
    const repo = getBoardsRepo();
    repo.createBoard(ctx, { name: "🔥신규고객" });
    repo.createBoard(ctx, { name: "🔥신규고객" });
    expect(resolveExistingNewcustBoard(ctx, repo)).toEqual({ kind: "missing" });
  });

  it("호출해도 구조 레코드를 만들지 않는다", () => {
    const ctx = owner();
    const repo = getBoardsRepo();
    const before = repo.listBoards(ctx);
    expect(resolveExistingNewcustBoard(ctx, repo)).toEqual({ kind: "missing" });
    expect(repo.listBoards(ctx)).toEqual(before);
  });
});
