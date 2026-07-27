import { describe, it, expect } from "vitest";
import { mergeCustom } from "./custom-merge";

// BUG-0003 회귀 방지: custom(jsonb) 부분수정 규약.
// 판정 기준은 "에러가 안 난다"가 아니라 **값이 남아 있다**는 긍정 확인이다.
describe("mergeCustom", () => {
  it("패치에 없는 키를 남긴다", () => {
    const got = mergeCustom(
      { contract_status: "written", exec_amount: 100_000_000 },
      { fee_pct: 3 },
    );
    expect(got.contract_status).toBe("written");
    expect(got.exec_amount).toBe(100_000_000);
    expect(got.fee_pct).toBe(3);
  });

  it("같은 키는 새 값으로 대체한다", () => {
    expect(mergeCustom({ fee_pct: 3 }, { fee_pct: 5 }).fee_pct).toBe(5);
  });

  it("null 값은 키를 삭제한다(빈 값 = 미입력)", () => {
    const got = mergeCustom({ a: 1, b: 2 }, { b: null });
    expect(got).toEqual({ a: 1 });
    expect("b" in got).toBe(false);
  });

  it("배열은 원소 병합이 아니라 통째 대체한다 — 지운 원소가 되살아나면 안 된다", () => {
    const got = mergeCustom({ files: [{ id: "f1" }, { id: "f2" }] }, { files: [{ id: "f2" }] });
    expect(got.files).toEqual([{ id: "f2" }]);
  });

  it("중첩 객체도 통째 대체한다(재귀 병합 안 함)", () => {
    const got = mergeCustom({ meta: { a: 1, b: 2 } }, { meta: { a: 9 } });
    expect(got.meta).toEqual({ a: 9 });
  });

  it("원본을 변경하지 않는다(불변)", () => {
    const base = { a: 1, b: 2 };
    mergeCustom(base, { a: 9, b: null, c: 3 });
    expect(base).toEqual({ a: 1, b: 2 });
  });

  it("base 가 없으면 패치만 남는다", () => {
    expect(mergeCustom(undefined, { a: 1 })).toEqual({ a: 1 });
    expect(mergeCustom(null, { a: null })).toEqual({});
  });

  it("빈 패치는 원본 그대로", () => {
    expect(mergeCustom({ a: 1 }, {})).toEqual({ a: 1 });
  });
});
