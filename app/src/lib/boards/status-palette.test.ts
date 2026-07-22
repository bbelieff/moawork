import { describe, it, expect } from "vitest";
import {
  STATUS_PALETTE,
  STATUS_EMPTY_COLOR,
  DUMMY_STATUS_OPTIONS,
  contrastTextColor,
  normalizeHex,
  pickPaletteColor,
  resolveStatusColor,
  toStatusChip,
} from "./status-palette";
import type { FieldOption } from "@/lib/types";

const OPTS: FieldOption[] = [
  { id: "o1", label: "대기", color: "#c4c4c4" },
  { id: "o2", label: "완료", color: "#00c875" },
  { id: "o3", label: "색없음" }, // color 미지정 → 팔레트 배정
];

describe("normalizeHex", () => {
  it("6자리 hex 를 소문자로", () => {
    expect(normalizeHex("#00C875")).toBe("#00c875");
  });
  it("3자리 축약형 확장", () => {
    expect(normalizeHex("#0C8")).toBe("#00cc88");
  });
  it("형식 아님은 null", () => {
    expect(normalizeHex("red")).toBeNull();
    expect(normalizeHex("")).toBeNull();
    expect(normalizeHex(null)).toBeNull();
    expect(normalizeHex("#12345")).toBeNull();
  });
});

describe("pickPaletteColor — 결정적", () => {
  it("같은 id 는 항상 같은 색", () => {
    expect(pickPaletteColor("abc")).toBe(pickPaletteColor("abc"));
  });
  it("항상 팔레트 안의 색", () => {
    for (const id of ["a", "b", "c", "긴-한글-아이디", "0000"]) {
      expect(STATUS_PALETTE).toContain(pickPaletteColor(id));
    }
  });
  it("서로 다른 id 는 대체로 다른 색(분산 확인)", () => {
    const ids = Array.from({ length: 40 }, (_, i) => `opt-${i}`);
    const used = new Set(ids.map(pickPaletteColor));
    expect(used.size).toBeGreaterThan(1);
  });
});

describe("resolveStatusColor", () => {
  it("지정색이 있으면 그것을 쓴다", () => {
    expect(resolveStatusColor(OPTS[1])).toBe("#00c875");
  });
  it("지정색이 없으면 팔레트에서 결정적으로 배정", () => {
    const c = resolveStatusColor(OPTS[2]);
    expect(STATUS_PALETTE).toContain(c);
    expect(resolveStatusColor(OPTS[2])).toBe(c);
  });
  it("잘못된 색 문자열도 팔레트로 폴백", () => {
    expect(STATUS_PALETTE).toContain(resolveStatusColor({ id: "x", label: "l", color: "red" }));
  });
});

describe("contrastTextColor — 가독성", () => {
  /** WCAG 상대휘도. */
  function luminance(hex: string): number {
    const ch = (i: number) => {
      const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * ch(0) + 0.7152 * ch(1) + 0.0722 * ch(2);
  }
  /** WCAG 명암비. */
  function ratio(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }

  it("극단값은 상식대로", () => {
    expect(contrastTextColor("#000000")).toBe("#ffffff");
    expect(contrastTextColor("#ffffff")).toBe("#1f1f1f");
  });

  it("팔레트·더미옵션·빈값 색 전부에서 본문 대비 AA(4.5:1) 이상을 확보한다", () => {
    const backgrounds = [
      ...STATUS_PALETTE,
      STATUS_EMPTY_COLOR,
      ...DUMMY_STATUS_OPTIONS.map((o) => o.color!),
    ];
    for (const bg of backgrounds) {
      expect(ratio(bg, contrastTextColor(bg)), `배경 ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("선택한 글자색이 반대색보다 대비가 크다(최대 대비 선택)", () => {
    for (const bg of STATUS_PALETTE) {
      const picked = contrastTextColor(bg);
      const other = picked === "#ffffff" ? "#1f1f1f" : "#ffffff";
      expect(ratio(bg, picked)).toBeGreaterThanOrEqual(ratio(bg, other));
    }
  });
});

describe("toStatusChip", () => {
  it("옵션 id 를 라벨·색으로 해석", () => {
    const chip = toStatusChip("o2", OPTS);
    expect(chip.label).toBe("완료");
    expect(chip.background).toBe("#00c875");
    expect(chip.color).toMatch(/^#/);
  });
  it("정의에 없는 값은 고아로 가시화(라벨=id, 회색)", () => {
    const chip = toStatusChip("ghost", OPTS);
    expect(chip.label).toBe("ghost");
    expect(chip.background).toBe("#c4c4c4");
  });
  it("옵션 목록이 없어도 안전", () => {
    expect(toStatusChip("x", null).label).toBe("x");
  });
});
