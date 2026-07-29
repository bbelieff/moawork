import { describe, it, expect } from "vitest";
import {
  CELL_FLASH_MAX_AGE,
  decodeCellFlash,
  encodeCellFlash,
  findCellError,
  type CellFlash,
} from "./cellFlash";

const FLASH: CellFlash = {
  itemId: "item-1",
  errors: [
    { key: "status", label: "상태", message: "선택지에 없는 옵션입니다" },
    { key: "due", label: "마감일", message: "존재하지 않는 날짜입니다" },
  ],
};

describe("인코딩 왕복", () => {
  it("담은 그대로 복원된다", () => {
    const encoded = encodeCellFlash(FLASH);
    expect(encoded).not.toBeNull();
    expect(decodeCellFlash(encoded)).toEqual(FLASH);
  });

  it("한글·따옴표·개행이 섞여도 안전하다", () => {
    const tricky: CellFlash = {
      itemId: "i-1",
      errors: [{ key: "note", label: '메"모', message: "값 '이상'\n두 줄" }],
    };
    expect(decodeCellFlash(encodeCellFlash(tricky))).toEqual(tricky);
  });

  it("쿠키 수명은 짧다(다음 렌더에서만 읽히면 된다)", () => {
    expect(CELL_FLASH_MAX_AGE).toBeGreaterThan(0);
    expect(CELL_FLASH_MAX_AGE).toBeLessThanOrEqual(30);
  });
});

describe("인코딩 — 담지 않는 경우", () => {
  it("오류가 없으면 null(쿠키를 만들지 않는다)", () => {
    expect(encodeCellFlash({ itemId: "i-1", errors: [] })).toBeNull();
  });

  it("itemId 가 없으면 null", () => {
    expect(encodeCellFlash({ itemId: "", errors: FLASH.errors })).toBeNull();
  });

  // 한글은 encodeURIComponent 에서 글자당 9자로 부푼다(%EA%B0%80).
  // 그래서 "글자 수 상한" 만으로는 쿠키 크기를 보장하지 못한다 — 아래 두 케이스가 그 경계다.

  it("오류가 많으면 전부 버리지 않고 앞쪽부터 담는다", () => {
    const many: CellFlash = {
      itemId: "i-1",
      errors: Array.from({ length: 50 }, (_, i) => ({
        key: `col-${i}`,
        label: `컬럼 ${i}`,
        message: "가".repeat(110),
      })),
    };
    const out = decodeCellFlash(encodeCellFlash(many));
    // 알릴 수 있는 만큼은 알린다(전멸 금지).
    expect(out).not.toBeNull();
    expect(out!.errors.length).toBeGreaterThan(0);
    expect(out!.errors.length).toBeLessThan(50);
    // 남은 것은 앞쪽 순서 그대로.
    expect(out!.errors[0].key).toBe("col-0");
  });

  it("한글 긴 메시지 1건도 버리지 않고 잘라서 담는다", () => {
    const long: CellFlash = {
      itemId: "i-1",
      errors: [{ key: "note", label: "메모", message: "가".repeat(500) }],
    };
    const encoded = encodeCellFlash(long);
    expect(encoded).not.toBeNull();
    expect(encoded!.length).toBeLessThanOrEqual(1500);

    const out = decodeCellFlash(encoded);
    expect(out?.errors[0].key).toBe("note");
    expect(out?.errors[0].message.length).toBeGreaterThan(0);
  });

  it("담은 결과는 항상 쿠키 상한 안에 있다", () => {
    const cases: CellFlash[] = [
      { itemId: "i", errors: [{ key: "k", label: "라벨", message: "짧음" }] },
      { itemId: "i", errors: [{ key: "k", label: "라", message: "가".repeat(400) }] },
      {
        itemId: "i",
        errors: Array.from({ length: 20 }, (_, n) => ({
          key: `k${n}`,
          label: "라벨",
          message: "메시지 ".repeat(20),
        })),
      },
    ];
    for (const c of cases) {
      const encoded = encodeCellFlash(c);
      if (encoded !== null) expect(encoded.length).toBeLessThanOrEqual(1500);
    }
  });
});

describe("디코딩 — 조작된 쿠키를 신뢰하지 않는다", () => {
  it.each([
    ["빈 값", ""],
    ["undefined", undefined],
    ["JSON 아님", "not-json"],
    ["배열", encodeURIComponent("[1,2,3]")],
    ["숫자", encodeURIComponent("42")],
    ["null", encodeURIComponent("null")],
    ["errors 누락", encodeURIComponent(JSON.stringify({ itemId: "i-1" }))],
    ["errors 가 배열 아님", encodeURIComponent(JSON.stringify({ itemId: "i", errors: {} }))],
    ["itemId 누락", encodeURIComponent(JSON.stringify({ errors: [{ key: "a", message: "b" }] }))],
  ])("%s → null", (_label, raw) => {
    expect(decodeCellFlash(raw)).toBeNull();
  });

  it("항목 중 형식이 어긋난 것만 걸러내고 나머지는 살린다", () => {
    const raw = encodeURIComponent(
      JSON.stringify({
        itemId: "i-1",
        errors: [
          { key: "ok", label: "정상", message: "사유" },
          { key: "", message: "키 없음" },
          { key: "no-msg", message: "" },
          "문자열",
          null,
        ],
      }),
    );
    const out = decodeCellFlash(raw);
    expect(out?.errors).toEqual([{ key: "ok", label: "정상", message: "사유" }]);
  });

  it("라벨이 비면 key 로 대체한다(빈 칸 표시 방지)", () => {
    const raw = encodeURIComponent(
      JSON.stringify({ itemId: "i-1", errors: [{ key: "status", message: "사유" }] }),
    );
    expect(decodeCellFlash(raw)?.errors[0].label).toBe("status");
  });

  it("유효 항목이 하나도 없으면 null", () => {
    const raw = encodeURIComponent(
      JSON.stringify({ itemId: "i-1", errors: [{ key: "", message: "" }] }),
    );
    expect(decodeCellFlash(raw)).toBeNull();
  });
});

describe("findCellError — 해당 셀에만 표시", () => {
  it("행·컬럼이 모두 맞을 때만 메시지를 준다", () => {
    expect(findCellError(FLASH, "item-1", "status")).toBe("선택지에 없는 옵션입니다");
  });

  it("다른 행에는 표시하지 않는다", () => {
    expect(findCellError(FLASH, "item-2", "status")).toBeNull();
  });

  it("다른 컬럼에는 표시하지 않는다", () => {
    expect(findCellError(FLASH, "item-1", "title")).toBeNull();
  });

  it("플래시가 없으면 null", () => {
    expect(findCellError(null, "item-1", "status")).toBeNull();
  });

  it("한 행의 여러 셀 오류를 각각 짚어준다", () => {
    expect(findCellError(FLASH, "item-1", "due")).toBe("존재하지 않는 날짜입니다");
  });
});
