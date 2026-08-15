import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "src/lib/repo/supabase/boardsRepo.ts"), "utf8");

describe("SupabaseBoardsRepo 아이템 프리셋 경계", () => {
  it("일반 목록은 템플릿만 숨기고 전용 조회는 같은 요청 결속 client를 쓴다", () => {
    expect(source).toContain("!isSectionPresetSource(board.source)");
    expect(source).toContain('like("source", "user.section-preset/%")');
    expect(source).not.toContain("createClient(");
  });
});
