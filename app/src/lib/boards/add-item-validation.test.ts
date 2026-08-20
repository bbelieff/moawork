import { describe, expect, it } from "vitest";
import { NEW_ITEM_TITLE_MAX, planNewItemSubmit } from "./add-item-validation";

describe("planNewItemSubmit", () => {
  it("빈 이름을 막고 오류 칸으로 이동하도록 지시한다", () => {
    expect(planNewItemSubmit("   ")).toMatchObject({
      submit: false,
      scrollToField: true,
      focusField: true,
    });
  });

  it("이름 한 칸과 서버의 300자 상한을 따른다", () => {
    expect(planNewItemSubmit("새 회사").submit).toBe(true);
    expect(planNewItemSubmit("가".repeat(NEW_ITEM_TITLE_MAX + 1)).submit).toBe(false);
  });
});
