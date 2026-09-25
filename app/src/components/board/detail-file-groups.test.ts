import { describe, expect, it } from "vitest";
import { groupDetailFile, groupDetailFiles } from "./detail-file-groups";
import type { ItemDetailFile } from "@/app/(app)/boards/item-detail-actions";

function file(name: string): ItemDetailFile {
  return { id: `id-${name}`, name, mime_type: "application/pdf", size_bytes: 1024, created_at: "2026-09-25T00:00:00Z" };
}

describe("증빙 파일 묶음은 파일명 기준 표시용 분류다", () => {
  it("사업자등록·부가세·기타로 나눈다", () => {
    expect(groupDetailFile("사업자등록증.pdf")).toBe("biz_registration");
    expect(groupDetailFile("2025_1기_부가세_신고서.pdf")).toBe("vat");
    expect(groupDetailFile("VAT_report.xlsx")).toBe("vat");
    expect(groupDetailFile("견적서.pdf")).toBe("other");
  });

  it("빈 묶음은 만들지 않고 순서를 유지한다", () => {
    const groups = groupDetailFiles([file("견적서.pdf"), file("사업자등록증.pdf")]);
    expect(groups.map((entry) => entry.group)).toEqual(["biz_registration", "other"]);
    expect(groups[0].files.map((entry) => entry.name)).toEqual(["사업자등록증.pdf"]);
  });
});
