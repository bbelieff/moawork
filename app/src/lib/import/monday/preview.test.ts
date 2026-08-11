import { describe, expect, it } from "vitest";
import { previewMondayImport } from "./preview";

const row = (rowNumber: number, externalItemId: string | null, companyName: string | null) => ({
  rowNumber,
  externalItemId,
  companyName,
  raw: { "회사명": companyName ?? "", "Monday item ID": externalItemId ?? "", "시도/시군구": "원본 그대로" },
});

describe("previewMondayImport", () => {
  it("같은 workspace의 정확한 Monday item ID만 안전하게 이미 처리됨으로 분류한다", () => {
    const preview = previewMondayImport({
      workspaceId: "workspace-a",
      rows: [row(2, "101", "가나"), row(1, "100", "다라")],
      existingLinks: [{ workspaceId: "workspace-a", externalItemId: "101" }, { workspaceId: "workspace-b", externalItemId: "100" }],
      existingCompanies: [],
    });

    expect(preview.rows.map((entry) => [entry.rowNumber, entry.decision])).toEqual([
      [1, "create"],
      [2, "skip_exact_duplicate"],
    ]);
  });

  it("파일 안의 같은 ID는 첫 행을 포함해 모두 거절하고, 누락도 적용 후보로 만들지 않는다", () => {
    const preview = previewMondayImport({
      workspaceId: "workspace-a",
      rows: [row(1, "101", "가나"), row(2, "101", "다라"), row(3, null, "라마"), row(4, "104", null)],
      existingLinks: [],
      existingCompanies: [],
    });

    expect(preview.rows.map((entry) => entry.decision)).toEqual(["reject", "reject", "reject", "reject"]);
    expect(preview.counts.reject).toBe(4);
  });

  it("opaque Monday item ID는 대소문자나 공백을 정규화하지 않는다", () => {
    const preview = previewMondayImport({
      workspaceId: "workspace-a",
      rows: [row(1, "AbC", "가나"), row(2, "abc", "다라"), row(3, "a b c", "라마")],
      existingLinks: [{ workspaceId: "workspace-a", externalItemId: "abc" }],
      existingCompanies: [],
    });

    expect(preview.rows.map((entry) => entry.decision)).toEqual(["create", "skip_exact_duplicate", "create"]);
  });

  it("회사명 유사성은 자동 병합하지 않고 사람 확인으로 남긴다", () => {
    const preview = previewMondayImport({
      workspaceId: "workspace-a",
      rows: [row(1, "101", "  가 나 주식회사 ")],
      existingLinks: [],
      existingCompanies: [{ workspaceId: "workspace-a", normalizedName: "가 나 주식회사" }],
    });

    expect(preview.rows[0]).toMatchObject({ decision: "needs_review", reasons: ["possible_company_duplicate"] });
    expect(preview.rows[0].raw).toEqual({ "회사명": "  가 나 주식회사 ", "Monday item ID": "101", "시도/시군구": "원본 그대로" });
  });

  it("동일 입력은 결정적으로 같은 preview를 만들고 CT01 전 지역을 원본 그대로 보존한다", () => {
    const input = { workspaceId: "workspace-a", rows: [row(1, "101", "가나")], existingLinks: [], existingCompanies: [] };
    expect(previewMondayImport(input)).toEqual(previewMondayImport(input));
    expect(previewMondayImport(input).regionPolicy).toBe("preserve_source_until_ct01");
  });

  it("workspaceId가 없으면 tenant 경계 없이 preview를 만들지 않는다", () => {
    expect(() => previewMondayImport({ workspaceId: " ", rows: [], existingLinks: [], existingCompanies: [] })).toThrow("workspaceId is required");
  });
});
