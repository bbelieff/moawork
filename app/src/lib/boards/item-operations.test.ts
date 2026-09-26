import { describe, expect, it } from "vitest";

import {
  buildNewLeadDuplicateInput,
  deriveItemRequestId,
  isDuplicateBlockedKey,
  isNewLeadDuplicateSource,
  itemOperationMessage,
  requiresCanonicalDuplicate,
  splitDuplicateKeys,
} from "./item-operations";

describe("복제 차단 키 (153 draft SQL 차단 집합과 동일)", () => {
  it("승인·직인·서명·계약·원장·히스토리·파일·담당·receipt는 복사하지 않는다", () => {
    for (const key of [
      "seal_status",
      "seal_approval",
      "approval_note",
      "esignature",
      "contract_confirm",
      "deposit_amount",
      "ledger_entry",
      "history_log",
      "file_docs",
      "assigned_owner",
      "assignment_receipt",
      "audit_trail",
      "payment_proof",
      "stamp_image",
    ]) {
      expect(isDuplicateBlockedKey(key)).toBe(true);
    }
  });

  it("일반 입력·정본 intake 키·시군구는 복사한다", () => {
    for (const key of ["memo", "title", "status", "due", "rep_name", "industry", "ad_name", "biz_reg_type", "sigungu", "region_sigungu", "phone"]) {
      expect(isDuplicateBlockedKey(key)).toBe(false);
    }
  });

  it("복사/제외를 가르고 개수를 센다", () => {
    expect(splitDuplicateKeys(["memo", "seal_status", "phone", "file_docs"])).toEqual({
      copied: ["memo", "phone"],
      skipped: ["seal_status", "file_docs"],
    });
  });
});

describe("정본 분기 판정", () => {
  it("정본 보드는 단순 복사를 쓰지 않는다 (계약업무 포함)", () => {
    expect(requiresCanonicalDuplicate("core.default-tab/new-lead")).toBe(true);
    expect(requiresCanonicalDuplicate("core.default-tab/contact")).toBe(true);
    expect(requiresCanonicalDuplicate("core.default-tab/contract-work")).toBe(true);
    expect(requiresCanonicalDuplicate("core.crm.pipeline")).toBe(true);
    expect(requiresCanonicalDuplicate("work")).toBe(true);
    expect(requiresCanonicalDuplicate("user")).toBe(false);
    expect(requiresCanonicalDuplicate(null)).toBe(false);
    expect(requiresCanonicalDuplicate(undefined)).toBe(false);
  });

  it("신규리드만 정본 생성 복제 대상이다", () => {
    expect(isNewLeadDuplicateSource("core.default-tab/new-lead")).toBe(true);
    expect(isNewLeadDuplicateSource("core.default-tab/contact")).toBe(false);
    expect(isNewLeadDuplicateSource("user")).toBe(false);
  });
});

describe("신규리드 정본 복제 입력", () => {
  it("허용된 intake 값만 문자열로 옮긴다 (EAV 직접 쓰기 아님 — 정본 RPC 입력)", () => {
    expect(
      buildNewLeadDuplicateInput({
        rep_name: "홍길동",
        phone: "010-1234-5678",
        industry: "제조업",
        ad_name: "검색광고",
        biz_reg_type: "개인",
        empty: "",
        count: 3,
        seal_status: "approved",
      }),
    ).toEqual({
      representative_name: "홍길동",
      phone: "010-1234-5678",
      industry: "제조업",
      acquisition_source: "검색광고",
      business_registration_type: "개인",
    });
  });
});

describe("재시도 멱등 키 (묶음 키 + 연산 + 항목 해시)", () => {
  it("같은 입력은 같은 requestId, 항목이 다르면 다르다", () => {
    const first = deriveItemRequestId("bulk-1", "archive", "item-a");
    expect(deriveItemRequestId("bulk-1", "archive", "item-a")).toBe(first);
    expect(deriveItemRequestId("bulk-1", "archive", "item-b")).not.toBe(first);
    expect(deriveItemRequestId("bulk-2", "archive", "item-a")).not.toBe(first);
    expect(deriveItemRequestId("bulk-1", "duplicate", "item-a")).not.toBe(first);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("보호 RPC 실패 메시지 (가드 약화 없이 명시)", () => {
  it("미적용 RPC는 구현 상세를 노출하지 않는 준비 중 메시지로 닫는다", () => {
    for (const error of [
      itemOperationMessage({ code: "42883", message: "function does not exist" }),
      itemOperationMessage({ code: "PGRST202", message: "could not find the function" }),
    ]) {
      expect(error).toMatch(/준비 중/);
      expect(error).not.toMatch(/153|초안|총괄/);
    }
  });

  it("권한·동시수정·순환·자기참조를 구분한다", () => {
    expect(itemOperationMessage({ code: "42501", message: "denied" })).toMatch(/권한/);
    expect(itemOperationMessage({ code: "40001", message: "stale" })).toMatch(/먼저 바꿨/);
    expect(itemOperationMessage({ code: "22023", message: "parent link would create a cycle" })).toMatch(/순환/);
    expect(itemOperationMessage({ code: "22023", message: "item cannot be its own parent" })).toMatch(/자기 자신/);
    expect(itemOperationMessage({ code: "22023", message: "parent must be in the same workspace and board" })).toMatch(/같은 보드/);
    expect(itemOperationMessage({ code: "22023", message: "canonical board requires canonical duplicate flow" })).toMatch(/정본/);
  });
});
