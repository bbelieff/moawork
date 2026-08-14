import { describe, expect, it } from "vitest";
import { boardCellValueFromFormData } from "./form-values";

describe("boardCellValueFromFormData person", () => {
  it("선택한 조직 멤버 ID를 저장 값으로 보존한다", () => {
    const form = new FormData();
    form.set("kind", "person");
    form.set("value", "member-account-b");
    expect(boardCellValueFromFormData(form)).toBe("member-account-b");
  });

  it("미배정 선택은 빈 문자열이 아니라 null로 저장한다", () => {
    const form = new FormData();
    form.set("kind", "person");
    form.set("value", "");
    expect(boardCellValueFromFormData(form)).toBeNull();
  });
});
