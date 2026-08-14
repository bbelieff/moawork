import { beforeEach, describe, expect, it } from "vitest";
import type { Ctx } from "@/lib/types";
import { getRepo } from "@/lib/repo";
import { resetDb } from "@/lib/repo/local/store";
import { SEED_ORG_ID, SEED_USER_OWNER } from "@/lib/repo/local/seed";
import { listOrgMemberOptions, toNameMap } from "./members";

// 테스트 환경에는 Supabase 환경변수가 없다 — 로컬(getRepo) 경로만 실행된다.
// Supabase 경로는 이 레포 전반의 관례대로 실DB 연결 시 T10 실측(NOT_RUN 표기)이다.

beforeEach(() => {
  resetDb();
});

function ctxOf(userId: string): Ctx {
  const repo = getRepo();
  const user = repo.getUser(userId);
  const org = repo.getOrg(SEED_ORG_ID);
  if (!user || !org) throw new Error("seed 누락");
  return { user, org, role: "owner", scope: "all" };
}

describe("listOrgMemberOptions — 로컬 폴백", () => {
  it("조직 멤버 목록을 돌려준다(시드에 최소 오너 포함)", async () => {
    const options = await listOrgMemberOptions(ctxOf(SEED_USER_OWNER));
    expect(options.some((m) => m.id === SEED_USER_OWNER)).toBe(true);
  });

  it("이메일 등 개인정보 필드를 담지 않는다(id/name 만)", async () => {
    const [first] = await listOrgMemberOptions(ctxOf(SEED_USER_OWNER));
    expect(Object.keys(first).sort()).toEqual(["id", "name"]);
  });
});

describe("toNameMap", () => {
  it("id → name 맵을 만든다", () => {
    const map = toNameMap([
      { id: "u1", name: "철수" },
      { id: "u2", name: null },
    ]);
    expect(map.get("u1")).toBe("철수");
    expect(map.get("u2")).toBeNull();
    expect(map.get("없는id")).toBeUndefined();
  });

  it("빈 목록도 안전하다", () => {
    expect(toNameMap([]).size).toBe(0);
  });
});
