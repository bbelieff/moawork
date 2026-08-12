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
import { validateCell, isEmptyCell, compareCells, formatCell, hasOptions } from "./cells";
import type { FieldOption } from "@/lib/types";

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
  it("문자열 계열은 trim, 빈문자는 빈 셀", () => {
    expect(validateCell("text", "  hi  ").value).toBe("hi");
    expect(validateCell("text", "   ").value).toBeNull();
    expect(validateCell("email", "a@b.com").value).toBe("a@b.com");
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
});

describe("formatCell", () => {
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
});
