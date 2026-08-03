import { describe, expect, it } from "vitest";
import { parseDeidentifiedCsv } from "./CsvImportDialog";

describe("parseDeidentifiedCsv", () => {
  it("maps the first column to a title and quarantines malformed rows", () => {
    const result = parseDeidentifiedCsv("고객명,담당자\n모아워크,김담당\n열부족\n");
    expect(result.rows).toEqual([{ title: "모아워크", values: { 담당자: "김담당" } }]);
    expect(result.quarantined).toBe(1);
  });

  it("supports quoted commas, escaped quotes, line breaks, and a UTF-8 BOM", () => {
    const result = parseDeidentifiedCsv('\uFEFF항목,메모\n"고객, A","첫째 줄\n둘째 ""줄"""\n');
    expect(result.rows).toEqual([{ title: "고객, A", values: { 메모: '첫째 줄\n둘째 "줄"' } }]);
    expect(result.quarantined).toBe(0);
  });

  it("rejects blank or duplicate headers", () => {
    expect(parseDeidentifiedCsv("항목,,담당\nA,B,C").rows).toEqual([]);
    expect(parseDeidentifiedCsv("항목,담당,담당\nA,B,C").rows).toEqual([]);
  });

  it("quarantines unclosed and stray quotes", () => {
    expect(parseDeidentifiedCsv('항목,메모\nA,"끝나지 않음').rows).toEqual([]);
    expect(parseDeidentifiedCsv('항목,메모\nA,잘못"된 값').rows).toEqual([]);
  });
});
