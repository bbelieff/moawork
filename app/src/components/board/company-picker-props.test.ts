import { describe, expect, it, vi } from "vitest";

import { buildCompanyPickerProps } from "./BoardWorkspace";
import { CONTRACT_WORK_TAB_SOURCE } from "@/lib/default-tabs/contract-work";
import { CONTACT_TAB_SOURCE } from "@/lib/default-tabs/types";
import type { CompanyPickerLoadResult } from "@/lib/companies/picker-server";

/**
 * 서버 → 화면 사이의 «아무도 안 보던 세 줄» 을 잰다 (#588 ②).
 *
 * ★ 서버가 「목록이 잘렸다」고 말해도 여기서 안 실어 보내면 화면은 모른 채
 *   「없으면 새로 등록하세요」라고 말한다 — 즉 이 화면이 막으려던 중복을 만든다.
 *   폼 테스트와 서버 테스트가 각각 초록이어도 이 자리가 끊기면 제품은 깨져 있다.
 */
const action = vi.fn(async () => ({ ok: true, message: "" }));

function result(overrides: Partial<CompanyPickerLoadResult> = {}): CompanyPickerLoadResult {
  return { rows: [], error: null, truncated: false, ...overrides };
}

describe("업체 추가 목록의 서버→화면 전달", () => {
  it("★ 잘렸다는 사실을 화면까지 실어 보낸다", () => {
    const props = buildCompanyPickerProps(CONTRACT_WORK_TAB_SOURCE, result({ truncated: true }), action);
    expect(props.companyPicker?.truncated).toBe(true);
  });

  it("안 잘렸으면 안 잘렸다고 전한다", () => {
    const props = buildCompanyPickerProps(CONTRACT_WORK_TAB_SOURCE, result(), action);
    expect(props.companyPicker?.truncated).toBe(false);
  });

  it("읽기 실패도 그대로 전한다 — 빈 목록으로 위장하지 않는다", () => {
    const props = buildCompanyPickerProps(CONTRACT_WORK_TAB_SOURCE, result({ error: "못 읽었어요" }), action);
    expect(props.companyPicker?.loadError).toBe("못 읽었어요");
  });

  it("계약업체 실무가 아니거나 액션이 없으면 아예 안 단다", () => {
    expect(buildCompanyPickerProps(CONTACT_TAB_SOURCE, result(), action)).toEqual({});
    expect(buildCompanyPickerProps(CONTRACT_WORK_TAB_SOURCE, result(), undefined)).toEqual({});
  });
});
