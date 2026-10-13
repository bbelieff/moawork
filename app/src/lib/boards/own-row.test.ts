import { beforeEach, describe, expect, it, vi } from "vitest";

const guard = vi.hoisted(() => ({ loadPermGuard: vi.fn() }));
vi.mock("@/lib/perm/guard", () => guard);

import { canTrashOwnRow } from "./own-row";
import type { Ctx } from "@/lib/types";

const ctx = { org: { id: "org-1" }, user: { id: "me" } } as unknown as Ctx;

describe("canTrashOwnRow (QA #883)", () => {
  beforeEach(() => guard.loadPermGuard.mockReset());

  it("항목 수정 권한이 있고 내가 맡은 행이면 허용", async () => {
    guard.loadPermGuard.mockResolvedValue({ kind: "allowed" });
    expect(await canTrashOwnRow(ctx, async () => "me", "item-1")).toBe(true);
  });

  it("남의 행·담당자 없음·수정 권한 없음·읽기 실패는 막는다", async () => {
    guard.loadPermGuard.mockResolvedValue({ kind: "allowed" });
    expect(await canTrashOwnRow(ctx, async () => "someone", "item-1")).toBe(false);
    expect(await canTrashOwnRow(ctx, async () => null, "item-1")).toBe(false);
    expect(await canTrashOwnRow(ctx, async () => { throw new Error("db"); }, "item-1")).toBe(false);
    guard.loadPermGuard.mockResolvedValue({ kind: "denied", reason: "permission" });
    expect(await canTrashOwnRow(ctx, async () => "me", "item-1")).toBe(false);
  });
});
