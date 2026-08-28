/**
 * cells 는 이제 T05 레지스트리(`lib/custom/field-types`)에 위임하는 얇은 어댑터다.
 * 따라서 이 테스트는 **위임 계약**을 검증한다 — 정규화 세부 규칙의 정본 테스트는
 * `lib/custom/field-types.test.ts`.
 *
 * [회귀 조정 — 기획2 판정 2026-07-21]
 * 구 `normalizeCellValue`/`validateAgainstOptions` 는 제거됐다. 형식 오류를 조용히
 * null 로 수렴시켜(데이터 유실) 관대 정책과 배치되기 때문. 대체 = `validateCell()`
 * → `{ok, value, error}`. 저장 여부 판단은 호출부(service) 정책.
 */

import { describe, it, expect } from "vitest";
import {
  cellSearchText,
  compareCells,
  formatCell,
  hasOptions,
  isEmptyCell,
  validateCell,
} from "./cells";
import { numericSearchIncludes } from "@/lib/format/number";
import type { FieldOption } from "@/lib/types";
import { emptyOtherInfoValue, updateOtherInfoEntry } from "./structured-field";

const OPTS: FieldOption[] = [
  { id: "o1", label: "대기" },
  { id: "o2", label: "완료" },
];

describe("validateCell — 정상 정규화(위임)", () => {
  it("checkbox 는 불리언, 빈값은 미설정(null)", () => {
    expect(validateCell("checkbox", true).value).toBe(true);
    expect(validateCell("checkbox", "true").value).toBe(true);
    expect(validateCell("checkbox", "false").value).toBe(false);
    // [엔진 계약] 구 boards 는 빈값을 false 로 수렴시켰으나, 레지스트리는 '미설정(null)'과
    // '해제(false)'를 구분한다. 표시상으로는 둘 다 빈 칸.
    expect(validateCell("checkbox", null).value).toBeNull();
  });
  it("number 는 콤마/통화기호 파싱", () => {
    expect(validateCell("number", "1,200,000").value).toBe(1200000);
    expect(validateCell("number", "₩ 1,200,000").value).toBe(1200000);
    expect(validateCell("number", "").value).toBeNull(); // 빈값은 빈 셀(오류 아님)
  });
  it("date 는 YYYY-MM-DD 로 정규화", () => {
    expect(validateCell("date", "2026-07-21").value).toBe("2026-07-21");
  });
  it("other_info 객체는 strict v1 그대로 저장하고 generic string 축약을 거부한다", () => {
    const value = updateOtherInfoEntry(emptyOtherInfoValue(), "otherBusinesses", {
      checked: true,
      text: "별도 사업자",
    });
    expect(validateCell("other_info", value)).toEqual({ ok: true, value });
    expect(validateCell("other_info", { version: 1 }).ok).toBe(false);
    expect(validateCell("other_info", "[object Object]").ok).toBe(false);
  });
  it("문자열 계열은 trim, 빈문자는 빈 셀", () => {
    expect(validateCell("text", "  hi  ").value).toBe("hi");
    expect(validateCell("text", "   ").value).toBeNull();
    expect(validateCell("email", "a@b.com").value).toBe("a@b.com");
  });
  it("phone 입력 형식은 같은 숫자 저장값으로 정규화", () => {
    expect(validateCell("phone", "010-1234-5678")).toEqual({ ok: true, value: "01012345678" });
    expect(validateCell("phone", "010 1234 5678")).toEqual({ ok: true, value: "01012345678" });
    expect(validateCell("phone", "+82 10-1234-5678")).toEqual({ ok: true, value: "01012345678" });
  });
  it("file은 registry의 canonical 객체 배열을 문자열로 축약하지 않는다", () => {
    const value = [{ path: "docs/a.pdf", name: "a.pdf", size: 12, mime: "application/pdf" }];
    expect(validateCell("file", value)).toEqual({ ok: true, value });
    expect(formatCell("file", value)).toBe("a.pdf");
  });
});

describe("validateCell — 형식 오류는 null 수렴이 아니라 ok:false", () => {
  it("숫자 아님", () => {
    const r = validateCell("number", "abc");
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
    expect(r.value).toBeNull(); // 저장하지 말 것
  });
  it("날짜 아님", () => {
    expect(validateCell("date", "nope").ok).toBe(false);
  });
  it("달력에 없는 날짜도 거부 — 구현에서 롤오버로 통과하던 케이스", () => {
    expect(validateCell("date", "2026-02-30").ok).toBe(false);
    expect(validateCell("date", "2026-13-01").ok).toBe(false);
  });
  it("이메일 형식 오류", () => {
    expect(validateCell("email", "not-an-email").ok).toBe(false);
  });
  it("판독 불가능한 phone 입력은 저장하지 않고 명시적으로 거부", () => {
    const result = validateCell("phone", "123");
    expect(result.ok).toBe(false);
    expect(result.value).toBeNull();
    expect(result.error).toContain("확인");
  });
});

describe("validateCell — 선택지 검증", () => {
  it("select 은 옵션 id 여야 통과", () => {
    expect(validateCell("select", "o1", OPTS).ok).toBe(true);
    expect(validateCell("select", "ghost", OPTS).ok).toBe(false);
    expect(validateCell("select", null, OPTS).ok).toBe(true); // 빈값 허용
  });
  it("multiselect 은 부분집합이어야 통과", () => {
    expect(validateCell("multiselect", ["o1", "o2"], OPTS).value).toEqual(["o1", "o2"]);
    expect(validateCell("multiselect", ["o1", "x"], OPTS).ok).toBe(false);
  });
  it("옵션 정의 없으면 통과(느슨한 보드)", () => {
    expect(validateCell("select", "anything", null).ok).toBe(true);
  });
  it("비선택 타입은 옵션 무관", () => {
    expect(validateCell("text", "free", OPTS).ok).toBe(true);
  });
});

describe("isEmptyCell / hasOptions", () => {
  it("빈값 판정", () => {
    expect(isEmptyCell(null)).toBe(true);
    expect(isEmptyCell("")).toBe(true);
    expect(isEmptyCell([])).toBe(true);
    expect(isEmptyCell(0)).toBe(false);
    expect(isEmptyCell(false)).toBe(false);
  });
  it("선택지 보유 타입", () => {
    expect(hasOptions("select")).toBe(true);
    expect(hasOptions("multiselect")).toBe(true);
    expect(hasOptions("text")).toBe(false);
  });
});

describe("compareCells — 빈값 뒤로", () => {
  it("숫자 오름차순", () => {
    expect(compareCells(1, 2)).toBeLessThan(0);
  });
  it("빈값은 항상 뒤", () => {
    expect(compareCells(null, 1)).toBeGreaterThan(0);
    expect(compareCells(1, null)).toBeLessThan(0);
    expect(compareCells(null, null)).toBe(0);
  });
  it("raw number는 2 < 10 < 100이고 숫자처럼 생긴 식별 문자열은 추측하지 않는다", () => {
    expect([100, 2, 10].sort(compareCells)).toEqual([2, 10, 100]);
    expect(compareCells("0010", "2")).toBeLessThan(0);
  });
});

describe("formatCell", () => {
  it("number와 money는 3자리 쉼표로 표시하되 raw 값은 바꾸지 않는다", () => {
    expect(formatCell("number", 1_234.5)).toBe("1,234.5");
    expect(formatCell("money", -1_234)).toBe("-1,234");
  });
  it("저장 경계가 허용한 작은 비영 number/money의 부호와 raw 검색값을 보존한다", () => {
    for (const raw of ["0.000000000000000000001", "-0.000000000000000000001"]) {
      const numberCell = validateCell("number", raw);
      const moneyCell = validateCell("money", raw);
      expect(numberCell).toEqual({ ok: true, value: Number(raw) });
      expect(moneyCell).toEqual({ ok: true, value: Number(raw) });
      expect(formatCell("number", numberCell.value)).toBe(raw);
      expect(formatCell("money", moneyCell.value)).toBe(raw);
      expect(cellSearchText("number", numberCell.value)).toBe(raw);
      expect(cellSearchText("money", moneyCell.value)).toBe(raw);
    }
  });
  it("옵션 id 를 라벨로 치환", () => {
    expect(formatCell("select", "o1", OPTS)).toBe("대기");
    expect(formatCell("multiselect", ["o1", "o2"], OPTS)).toBe("대기, 완료");
  });
  it("checkbox 는 체크 표시", () => {
    expect(formatCell("checkbox", true)).toBe("✓");
    expect(formatCell("checkbox", false)).toBe("");
  });
  it("phone 은 하이픈 포맷 (BBE-138 — @/lib/format 소비)", () => {
    expect(formatCell("phone", "01012345678")).toBe("010-1234-5678");
    expect(formatCell("phone", "010-1234-5678")).toBe("010-1234-5678");
  });
  it("phone 판독 불가는 «확인 필요»", () => {
    expect(formatCell("phone", "abc")).toBe("확인 필요");
  });
  it("숫자 검색 seam은 raw와 display를 함께 제공해 1234와 1,234가 동등하다", () => {
    const searchText = cellSearchText("number", 1_234);
    expect(searchText).toBe("1234 1,234");
    expect(numericSearchIncludes(searchText, "1234")).toBe(true);
    expect(numericSearchIncludes(searchText, "1,234")).toBe(true);
  });
  it("식별 문자열·날짜·전화는 숫자 검색/포맷을 거치지 않는다", () => {
    expect(cellSearchText("text", "001234")).toBe("001234");
    expect(cellSearchText("date", "2026-08-27")).toBe("2026-08-27");
    expect(cellSearchText("phone", "01012345678")).toBe("010-1234-5678");
  });
  it("other_info는 실제 체크 수와 검색 텍스트를 제공한다", () => {
    const value = updateOtherInfoEntry(emptyOtherInfoValue(), "certifications", {
      checked: true,
      text: "ISO 9001",
    });
    expect(formatCell("other_info", value)).toBe("1건");
    expect(cellSearchText("other_info", value)).toContain("ISO 9001");
  });
});
