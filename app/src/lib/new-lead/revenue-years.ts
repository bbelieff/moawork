/**
 * 「매출」 — 연도별 네 칸 (#673).
 *
 * ## 왜 한 칸이 아니라 넷인가
 *
 * 전에는 「3개년매출(백만원)」 숫자 한 칸이었다. 그런데 **그 칸이 무엇인지 알 수 없다** —
 * 3년 합계인가, 작년치인가, 평균인가. 적는 사람마다 다르게 적으면 그 숫자는 비교할 수 없다.
 * 연도로 나누면 «늘고 있나 줄고 있나» 가 보이고, 그게 이 숫자를 보는 이유다.
 *
 * ## 단위와 표기
 *
 *     단위   백만원 (전과 같다)
 *     표기   천단위 콤마    1,250
 *
 * 콤마가 없으면 `3500000` 이 350만인지 3,500,000인지 눈으로 못 읽는다.
 * 실제로 운영 화면에 그렇게 떠 있었다.
 *
 * ## 옛 칸을 지우지 않는다
 *
 * `revenue_3y_million` 과 `revenue_band` 는 그대로 산다. 구조가 줄어든 변경은 무조건 FAIL 이고
 * (D71~D75), 이미 들어간 값이 있다. 새 잎 넷을 «더할» 뿐이다.
 */

/** 잎 넷. 순서가 곧 화면의 왼→오이고, 최신이 먼저다. */
export const REVENUE_YEAR_FIELDS = [
  { key: "revenue_y0", label: "Y-현재", offset: 0 },
  { key: "revenue_y1", label: "Y-1", offset: 1 },
  { key: "revenue_y2", label: "Y-2", offset: 2 },
  { key: "revenue_y3", label: "Y-3", offset: 3 },
] as const;

export type RevenueYearKey = (typeof REVENUE_YEAR_FIELDS)[number]["key"];

/*
 * 보이는 컬럼은 «새로 만들지 않는다». `revenue_3y_million` 이 이미 신용점수와 같은
 * 합성 자리라(new-lead.ts 의 NEW_LEAD_COMPOSITE_PRESENTATION_COLUMNS), 그 칸의 이름을
 * 「매출」로 바꾸고 잎만 넷 물린다. 키를 갈면 이미 들어간 값이 딸려 오지 않는다.
 */
export const REVENUE_UNIT_LABEL = "백만원";

/**
 * 사람이 적은 것을 숫자로 읽는다.
 *
 * ★ 콤마는 «적는 사람이 넣는다». 지우고 읽어야 `1,250` 이 1250 이 된다.
 * ★ 음수·소수·글자는 받지 않는다. 매출은 백만원 «단위의 정수» 다 —
 *   0.5 백만원을 적고 싶으면 그건 단위가 잘못된 것이다.
 * ★ 0 은 «값» 이다. 매출이 0 인 해가 있을 수 있으므로 null 과 구분한다.
 */
export function parseRevenueMillion(input: unknown): number | null {
  if (typeof input === "number") {
    return Number.isSafeInteger(input) && input >= 0 ? input : null;
  }
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  // 숫자로 시작하고 «숫자로 끝나야» 한다 — 「100,」 같은 반쪽을 값으로 받지 않는다.
  if (!/^\d(?:[\d,]*\d)?$/u.test(trimmed)) return null;
  const digits = trimmed.replace(/,/gu, "");
  if (!/^\d+$/u.test(digits)) return null;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : null;
}

/** 화면에 쓸 글자. 값이 없으면 빈 문자열 — 「0」 을 대신 보여 주지 않는다. */
export function formatRevenueMillion(value: number | null): string {
  if (value === null) return "";
  return value.toLocaleString("ko-KR");
}

/** 적는 도중에도 콤마가 따라오게 한다. 못 읽는 글자는 버리지 않고 그대로 둔다. */
export function formatRevenueInput(raw: string): string {
  const parsed = parseRevenueMillion(raw);
  return parsed === null ? raw : formatRevenueMillion(parsed);
}

export type RevenueYears = Readonly<Record<RevenueYearKey, number | null>>;

/** 아이템 값에서 네 해를 읽는다. */
export function readRevenueYears(values: Record<string, unknown>): RevenueYears {
  const out = {} as Record<RevenueYearKey, number | null>;
  for (const field of REVENUE_YEAR_FIELDS) {
    out[field.key] = parseRevenueMillion(values?.[field.key]);
  }
  return out;
}

/**
 * 표의 한 칸에 넣을 요약.
 *
 * ★ 값이 하나도 없으면 빈 문자열이다. 「—」 같은 것을 여기서 정하지 않는다 —
 *   그건 화면이 정할 일이고, 여기서 정하면 표·상세·내보내기가 각자 다르게 그린다.
 */
export function revenueYearsSummary(years: RevenueYears): string {
  const parts = REVENUE_YEAR_FIELDS
    .map((field) => ({ label: field.label, value: years[field.key] }))
    .filter((entry) => entry.value !== null);
  if (parts.length === 0) return "";
  return parts.map((entry) => `${entry.label} ${formatRevenueMillion(entry.value)}`).join(" · ");
}

/**
 * 정렬에 쓸 하나의 수 — «가장 최근에 값이 있는 해» 를 쓴다.
 *
 * ★ 합계를 쓰지 않는다. 세 해를 적은 회사와 한 해만 적은 회사를 합계로 견주면
 *   «많이 적은 쪽» 이 커 보인다. 그건 매출이 아니라 성실도를 정렬하는 것이다.
 */
export function sortableRevenueYears(years: RevenueYears): number | null {
  for (const field of REVENUE_YEAR_FIELDS) {
    const value = years[field.key];
    if (value !== null) return value;
  }
  return null;
}
