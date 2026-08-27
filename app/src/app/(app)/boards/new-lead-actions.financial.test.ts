import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  revalidate: vi.fn(),
  setCells: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ set: vi.fn() })) }));
vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(async () => ({ org: { id: "org-a" }, user: { id: "user-a" } })),
}));
vi.mock("@/lib/perm/guard", () => ({ loadPermGuard: mocks.permission }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ rpc: vi.fn() })) }));
vi.mock("@/lib/boards/server", () => ({
  createRequestBoards: vi.fn(async () => ({ service: { setCells: mocks.setCells } })),
}));
vi.mock("@/lib/new-lead/mutations", () => ({
  canonicalAssignee: vi.fn(),
  createCanonicalNewLead: vi.fn(),
  updateCanonicalNewLead: vi.fn(),
  updateCanonicalNewLeadMeta: vi.fn(),
  updateCanonicalNewLeadTitle: vi.fn(),
  NewLeadMutationError: class NewLeadMutationError extends Error {},
}));
vi.mock("@/lib/new-lead/advance", () => ({
  advanceNewLeadToContact: vi.fn(),
  NewLeadAdvanceError: class NewLeadAdvanceError extends Error {},
}));

import {
  saveNewLeadCreditScoresAction,
  saveNewLeadCreditScoreAction,
  saveNewLeadFoundedDateAction,
  saveNewLeadLoanProfileAction,
  saveNewLeadRevenue3yAction,
} from "./new-lead-actions";

function baseForm() {
  const data = new FormData();
  data.set("boardId", "board-a");
  data.set("itemId", "item-a");
  return data;
}

describe("Issue #589 신규리드 재무 저장", () => {
  beforeEach(() => {
    mocks.permission.mockReset().mockResolvedValue({ kind: "allowed" });
    mocks.revalidate.mockReset();
    mocks.setCells.mockReset().mockResolvedValue({ errors: [] });
  });

  it("여러 기대출을 stable id 목록 한 셀로 원자 저장한다", async () => {
    const data = baseForm();
    const records = [
      { id: "loan-a", provider: "기업은행", month: "2026-08", amount: 30_000_000, rate: 3.75, terms: "만기일시상환", notes: "보증서 90%" },
      { id: "loan-b", provider: "국민은행", month: "2025-01", amount: 10_000_000, rate: 4.1, terms: "원리금균등", notes: "" },
    ];
    data.set("loanRecords", JSON.stringify(records));

    await expect(saveNewLeadLoanProfileAction({ ok: false, message: "" }, data)).resolves.toEqual({
      ok: true,
      message: "기대출 정보를 저장했습니다.",
    });
    expect(mocks.setCells).toHaveBeenCalledTimes(1);
    expect(mocks.setCells).toHaveBeenCalledWith(
      expect.objectContaining({ org: { id: "org-a" } }),
      "board-a",
      "item-a",
      { existing_loan_records: JSON.stringify(records) },
    );
  });

  it("중복 기대출 id는 저장소에 도달하기 전에 전부 거부한다", async () => {
    const data = baseForm();
    const duplicate = { id: "same", provider: "", month: "", amount: null, rate: null, terms: "", notes: "" };
    data.set("loanRecords", JSON.stringify([duplicate, duplicate]));
    expect((await saveNewLeadLoanProfileAction({ ok: false, message: "" }, data)).ok).toBe(false);
    expect(mocks.setCells).not.toHaveBeenCalled();
  });

  it("기존 기대출을 모두 삭제하면 명시적 빈 목록을 저장해 legacy 값이 되살아나지 않는다", async () => {
    const data = baseForm();
    data.set("loanRecords", "[]");

    await expect(saveNewLeadLoanProfileAction({ ok: false, message: "" }, data)).resolves.toEqual({
      ok: true,
      message: "기대출 정보를 저장했습니다.",
    });
    expect(mocks.setCells).toHaveBeenCalledWith(
      expect.anything(),
      "board-a",
      "item-a",
      { existing_loan_records: "[]" },
    );
  });

  it.each([
    ["credit_score_ncb", "NCB"],
    ["credit_score_kcb", "KCB"],
  ])("%s 점수만 선택한 기관 키에 저장한다", async (fieldKey, label) => {
    const data = baseForm();
    data.set("fieldKey", fieldKey);
    data.set("score", "812");

    await expect(saveNewLeadCreditScoreAction({ ok: false, message: "" }, data)).resolves.toEqual({
      ok: true,
      message: `${label} 점수를 저장했습니다.`,
    });
    expect(mocks.setCells).toHaveBeenCalledWith(
      expect.anything(),
      "board-a",
      "item-a",
      { [fieldKey]: 812 },
    );
  });

  it("기관 미상 키와 범위 밖 점수는 저장소에 도달하지 않는다", async () => {
    const unknown = baseForm();
    unknown.set("fieldKey", "credit_score");
    unknown.set("score", "812");
    await expect(saveNewLeadCreditScoreAction({ ok: false, message: "" }, unknown)).resolves.toEqual({
      ok: false,
      message: "신용점수를 저장할 회사를 확인해 주세요.",
    });

    const outOfRange = baseForm();
    outOfRange.set("fieldKey", "credit_score_ncb");
    outOfRange.set("score", "1001");
    expect((await saveNewLeadCreditScoreAction({ ok: false, message: "" }, outOfRange)).ok).toBe(false);
    expect(mocks.setCells).not.toHaveBeenCalled();
  });

  it("합성 신용점수 셀은 NCB/KCB durable key를 한 번의 저장으로 갱신한다", async () => {
    const data = baseForm();
    data.set("ncb", "812");
    data.set("kcb", "745");

    await expect(saveNewLeadCreditScoresAction({ ok: false, message: "" }, data)).resolves.toEqual({
      ok: true,
      message: "NCB와 KCB 점수를 저장했습니다.",
    });
    expect(mocks.setCells).toHaveBeenCalledTimes(1);
    expect(mocks.setCells).toHaveBeenCalledWith(
      expect.anything(),
      "board-a",
      "item-a",
      { credit_score_ncb: 812, credit_score_kcb: 745 },
    );
  });

  it("합성 신용점수 중 하나라도 잘못되면 두 점수 모두 저장하지 않는다", async () => {
    const data = baseForm();
    data.set("ncb", "812");
    data.set("kcb", "1001");
    expect((await saveNewLeadCreditScoresAction({ ok: false, message: "" }, data)).ok).toBe(false);
    expect(mocks.setCells).not.toHaveBeenCalled();
  });

  it.each(["2026-08", "2026-08-27"])("창업일 %s의 입력 정밀도를 그대로 저장한다", async (value) => {
    const data = baseForm();
    data.set("foundedDate", value);
    expect((await saveNewLeadFoundedDateAction({ ok: false, message: "" }, data)).ok).toBe(true);
    expect(mocks.setCells).toHaveBeenCalledWith(expect.anything(), "board-a", "item-a", {
      founded_month: value,
    });
  });

  it("백만원 매출은 새 숫자 key만 갱신하고 legacy revenue_band는 건드리지 않는다", async () => {
    const data = baseForm();
    data.set("revenue3yMillion", "1,234");
    expect((await saveNewLeadRevenue3yAction({ ok: false, message: "" }, data)).ok).toBe(true);
    expect(mocks.setCells).toHaveBeenCalledWith(expect.anything(), "board-a", "item-a", {
      revenue_3y_million: 1234,
    });
    expect(mocks.setCells.mock.calls[0]?.[3]).not.toHaveProperty("revenue_band");
  });
});
