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
  saveNewLeadCreditScoreAction,
  saveNewLeadLoanProfileAction,
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

  it("기대출 여섯 값을 한 번의 같은-item 저장으로 묶는다", async () => {
    const data = baseForm();
    data.set("loanProvider", "기업은행");
    data.set("loanMonth", "2026-08");
    data.set("loanAmount", "30,000,000");
    data.set("loanRate", "3.75");
    data.set("loanTerms", "만기일시상환");
    data.set("loanNotes", "보증서 90%");

    await expect(saveNewLeadLoanProfileAction({ ok: false, message: "" }, data)).resolves.toEqual({
      ok: true,
      message: "기대출 정보를 저장했습니다.",
    });
    expect(mocks.setCells).toHaveBeenCalledTimes(1);
    expect(mocks.setCells).toHaveBeenCalledWith(
      expect.objectContaining({ org: { id: "org-a" } }),
      "board-a",
      "item-a",
      {
        existing_loan_provider: "기업은행",
        existing_loan_month: "2026-08",
        existing_loans: 30_000_000,
        existing_loan_rate: 3.75,
        existing_loan_terms: "만기일시상환",
        existing_loan_notes: "보증서 90%",
      },
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
});
