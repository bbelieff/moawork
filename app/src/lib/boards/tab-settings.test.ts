import { describe, expect, it } from "vitest";
import type { BoardGroup } from "./types";
import { tabSettingsSubtitles, tabStageNote, tabStageRows } from "./tab-settings";
import { CONTRACT_WORK_TAB_SOURCE } from "@/lib/default-tabs/contract-work";
import { CONTACT_TAB_SOURCE, NEW_LEAD_TAB_SOURCE } from "@/lib/default-tabs/types";

const group = (id: string, name: string, sort_order: number) =>
  ({ id, org_id: "o", board_id: "b", name, color: null, sort_order }) as BoardGroup;

describe("탭 설정 › 단계 줄 (#845)", () => {
  it("그룹 순서대로 줄을 만들고, 넘겨받은(권한 안의) 행만 센다", () => {
    const rows = tabStageRows(null, [], [group("g2", "둘째", 1), group("g1", "첫째", 0), group("g3", "셋째", 2)], [
      { group_id: "g1" },
      { group_id: "g1" },
      { group_id: "g3" },
      { group_id: null },
    ]);
    expect(rows.map((row) => [row.id, row.name, row.rowCount])).toEqual([
      ["g1", "첫째", 2],
      ["g2", "둘째", 0],
      ["g3", "셋째", 1],
    ]);
  });

  it("단계 점은 표의 그룹 띠와 같은 톤 토큰을 쓴다(고정 색 값 없음)", () => {
    const rows = tabStageRows(CONTRACT_WORK_TAB_SOURCE, [], [group("g1", "심사 중", 0), group("g2", "대출불가", 1)], []);
    for (const row of rows) expect(row.accent).toMatch(/^var\(--mw-(tab-[ab]-[1-5]|tab-stop|sub)\)$/u);
  });

  it("흐름이 있는 탭만 한 줄 안내가 있다 — 계약업체 실무는 단계 = 보드", () => {
    expect(tabStageNote(CONTRACT_WORK_TAB_SOURCE)).toContain("단계 = 보드");
    expect(tabStageNote(CONTRACT_WORK_TAB_SOURCE)).toContain("진행현황");
    expect(tabStageNote(NEW_LEAD_TAB_SOURCE)).toContain("진행현황");
    expect(tabStageNote(CONTACT_TAB_SOURCE)).toContain("업무이동");
    expect(tabStageNote(null)).toBeNull();
    expect(tabStageNote("user-tab")).toBeNull();
  });

  it("머리말 설명은 개수를 말하고, 연결된 탭만 «진행현황과 연결» 을 덧붙인다", () => {
    expect(tabSettingsSubtitles(CONTRACT_WORK_TAB_SOURCE, 29, 14)).toEqual({
      general: "이름 · 아이콘 · 설명",
      fields: "29개",
      stages: "14개 · 진행현황과 연결",
    });
    expect(tabSettingsSubtitles(null, 3, 2).stages).toBe("2개");
  });
});
