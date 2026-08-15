import { describe, expect, it } from "vitest";
import type { Ctx } from "@/lib/types";
import { SECTION_PRESET_SOURCE } from "@/lib/presets/section-presets";
import { LocalBoardsRepo } from "./boardsRepo";

const ctx = {
  org: { id: "org-preset-boundary", name: "테스트 회사", plan_tier: "test", created_at: "2026-08-15T00:00:00Z" },
  user: { id: "user-preset-boundary", email: null, name: "테스터", avatar_url: null, created_at: "2026-08-15T00:00:00Z" },
  role: "owner",
  scope: "all",
  isPlatformAdmin: false,
} satisfies Ctx;

describe("아이템 프리셋 보드 경계", () => {
  it("제품/default 탭은 보존하고 템플릿 source만 일반 탭 목록에서 숨긴다", () => {
    const repo = new LocalBoardsRepo();
    const product = repo.createBoard(ctx, { name: "업무", source: "core.default-tab/work" });
    const preset = repo.createBoard(ctx, { name: "영업 구조", source: `${SECTION_PRESET_SOURCE}sample` });

    expect(repo.listBoards(ctx).map((board) => board.id)).toContain(product.id);
    expect(repo.listBoards(ctx).map((board) => board.id)).not.toContain(preset.id);
    expect(repo.listSectionPresetBoards(ctx).map((board) => board.id)).toEqual([preset.id]);

    repo.deleteBoard(ctx, product.id);
    repo.deleteBoard(ctx, preset.id);
  });
});
