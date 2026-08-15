import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(join(process.cwd(), "src/app/(app)/presets/page.tsx"), "utf8");
const actions = readFileSync(join(process.cwd(), "src/app/(app)/presets/actions.ts"), "utf8");

describe("BBE-158 프리셋 라이브러리", () => {
  it("D76 탭 생성·이름 수정과 D77 마지막 탭 삭제·0개 상태를 노출한다", () => {
    expect(page).toContain("+ 탭 만들기");
    expect(page).toContain("이름 저장");
    expect(page).toContain("아직 탭이 없어요");
    expect(page).toContain("deleteTabAction");
  });

  it("아이템 묶음 구조를 저장하고 다른 탭에서 재사용한다", () => {
    expect(page).toContain("saveSectionPresetAction");
    expect(page).toContain("applySectionPresetAction");
    expect(actions).toContain("snapshotSectionPreset");
    expect(actions).toContain("existingKeys");
  });

  it("설치 개념을 되살리지 않고 요청 결속 Supabase 어댑터만 쓴다", () => {
    expect(page).not.toContain("구조 팩 설치");
    expect(actions).toContain("new SupabaseBoardsRepo(client)");
    expect(actions).not.toContain("getBoardsService");
    expect(actions).not.toContain("LocalBoardsRepo");
    expect(page).toContain("new SectionPresetRepo(boardsRepo)");
  });
});
