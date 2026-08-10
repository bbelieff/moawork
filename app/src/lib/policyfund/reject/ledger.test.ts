import { describe, expect, it } from "vitest";
import { RejectionLedger, rejectionReasonText, selectBatchTargets } from "./ledger";

const rejection = (overrides: Partial<Parameters<RejectionLedger["record"]>[0]> = {}) => ({
  companyId: "company-1",
  policyfundItemId: "item-1",
  assigneeId: "user-1",
  reason: "credit" as const,
  rejectedAt: "2026-08-20",
  reapplyNoticeDate: "2027-08-20",
  ...overrides,
});

describe("부결 사유", () => {
  it("정해진 사유를 고르고 기타는 직접 입력한다", () => {
    expect(rejectionReasonText({ reason: "credit" })).toBe("신용 기준 미충족");
    expect(rejectionReasonText({ reason: "other", otherReason: " 보증기관 추가 확인 필요 " })).toBe(
      "보증기관 추가 확인 필요",
    );
    expect(() => rejectionReasonText({ reason: "other", otherReason: " " })).toThrow(/기타 사유/);
  });
});

describe("업체 마스터 부결 이력", () => {
  it("같은 업체의 부결을 덮지 않고 차곡차곡 쌓는다", () => {
    const ledger = new RejectionLedger();
    ledger.record(rejection());
    ledger.record(rejection({ policyfundItemId: "item-2", reason: "documents", rejectedAt: "2026-09-01" }));

    expect(ledger.historyForCompany("company-1")).toHaveLength(2);
    expect(ledger.historyForCompany("company-1").map((entry) => entry.reasonText)).toEqual([
      "신용 기준 미충족",
      "서류 보완 필요",
    ]);
  });

  it("기간 안의 재신청 대상을 업체별 최신 부결 1건으로 조회한다", () => {
    const ledger = new RejectionLedger();
    ledger.record(rejection());
    ledger.record(rejection({ policyfundItemId: "item-2", rejectedAt: "2026-09-01" }));
    ledger.record(rejection({ companyId: "company-2", policyfundItemId: "item-3", reapplyNoticeDate: "2027-09-10" }));

    const targets = ledger.reapplyTargets("2027-08-01", "2027-08-31");
    expect(targets).toHaveLength(1);
    expect(targets[0].latestRejection.policyfundItemId).toBe("item-2");
  });

  it("업체의 최신 부결이 기간 밖이면 과거 부결을 다시 노출하지 않는다", () => {
    const ledger = new RejectionLedger();
    ledger.record(rejection({ policyfundItemId: "old", rejectedAt: "2026-08-20", reapplyNoticeDate: "2027-08-20" }));
    ledger.record(rejection({ policyfundItemId: "latest", rejectedAt: "2026-09-01", reapplyNoticeDate: "2027-09-01" }));

    expect(ledger.reapplyTargets("2027-08-01", "2027-08-31")).toEqual([]);
  });

  it("목록에서 고른 업체만 중복 없이 묶는다", () => {
    const ledger = new RejectionLedger();
    ledger.record(rejection());
    const targets = ledger.reapplyTargets("2027-08-20", "2027-08-20");
    expect(selectBatchTargets(targets, ["company-1", "company-1", "missing"])).toEqual({
      targetIds: ["company-1"],
      count: 1,
    });
    expect(() => selectBatchTargets(targets, ["missing"])).toThrow(/한 곳 이상/);
  });
});
