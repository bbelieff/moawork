import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CANONICAL_REGIONS, normalizeRegion, regionOptions } from "./region-options";

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED_002 = join(HERE, "..", "..", "..", "..", "supabase", "migrations", "002_seed_policyfund.sql");

/** 002 `field_presets.region` 218지 — 정규화 이전의 컨텍관리 표기. */
function region002(): string[] {
  const sql = readFileSync(SEED_002, "utf8");
  const at = sql.indexOf('"field_presets"');
  const open = sql.indexOf("{", at + '"field_presets"'.length);
  let depth = 0;
  let close = -1;
  for (let i = open; i < sql.length; i += 1) {
    if (sql[i] === "{") depth += 1;
    else if (sql[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        close = i + 1;
        break;
      }
    }
  }
  return JSON.parse(sql.slice(open, close)).region as string[];
}

describe("공용 지역 세트 — 시드 확정 ②", () => {
  it("222지이고 중복이 없다", () => {
    expect(CANONICAL_REGIONS).toHaveLength(222);
    expect(new Set(CANONICAL_REGIONS).size).toBe(222);
  });

  it("모든 항목이 `시도_시군구` 형식이다 — 접미사 없는 축약 표기 0건", () => {
    for (const region of CANONICAL_REGIONS) {
      const [sido, ...rest] = region.split("_");
      expect(sido, region).toBeTruthy();
      expect(rest, `${region} 는 시도_시군구 한 쌍이어야 한다`).toHaveLength(1);
      expect(rest[0], region).toMatch(/[시군구]$/);
    }
  });

  it("같은 지역의 축약형·정식형이 함께 남아 있지 않다", () => {
    const all = new Set(CANONICAL_REGIONS);
    for (const region of CANONICAL_REGIONS) {
      for (const suffix of ["시", "군", "구"]) {
        expect(all.has(region + suffix), `${region} 와 ${region}${suffix} 가 공존한다`).toBe(false);
      }
    }
  });

  it("시도별 개수가 대조표와 같다", () => {
    const counted: Record<string, number> = {};
    for (const region of CANONICAL_REGIONS) {
      const sido = region.split("_")[0];
      counted[sido] = (counted[sido] ?? 0) + 1;
    }
    expect(counted).toEqual({
      서울: 25, 부산: 16, 대구: 8, 인천: 10, 광주: 5, 대전: 5, 울산: 5, 경기: 31,
      강원도: 18, 충북: 11, 충남: 15, 전북: 13, 전남: 22, 경북: 22, 경남: 16,
    });
  });

  it("002 지역 218지가 전부 정규화 세트로 대응된다 — 값 유실 0", () => {
    const before = region002();
    expect(before).toHaveLength(218);

    const unmapped = before.filter((label) => normalizeRegion(label) === null);
    expect(unmapped, "대응되지 않은 002 지역").toEqual([]);

    // 대응 결과는 반드시 세트 안의 값이어야 한다(긍정 확인 — F12).
    const all = new Set(CANONICAL_REGIONS);
    for (const label of before) expect(all.has(normalizeRegion(label)!), label).toBe(true);
  });

  it("먼데이 축약·오기 표기를 정규 항목으로 옮긴다", () => {
    expect(normalizeRegion("강원도_강릉")).toBe("강원도_강릉시");
    expect(normalizeRegion("서울_영등포")).toBe("서울_영등포구");
    expect(normalizeRegion("서울_영등포구")).toBe("서울_영등포구");
    expect(normalizeRegion("인천_남동")).toBe("인천_남동구");
    expect(normalizeRegion("충북_영통군")).toBe("충북_영동군"); // 먼데이 원문 오기
    expect(normalizeRegion("제주_제주")).toBeNull(); // 두 원본에 없는 값은 만들어내지 않는다
  });

  it("팩 선택지 형식은 id=label, order 0부터 연속이다", () => {
    const options = regionOptions();
    expect(options).toHaveLength(222);
    expect(options.map((o) => o.order)).toEqual(options.map((_, index) => index));
    for (const option of options) expect(option.id).toBe(option.label);
  });
});
