import { describe, expect, it } from "vitest";
import { parseDeidentifiedCsv } from "@/components/workspace-builder/CsvImportDialog";
import {
  IMPORT_ROW_CAP,
  mapCsvToCompanies,
  parseFoundedOn,
  parseRevenue,
  resolveHeaderMap,
} from "./csv-import";

describe("고객사 CSV 매핑", () => {
  it("먼데이 헤더 이름을 표준 필드로 알아본다", () => {
    const map = resolveHeaderMap(["회사명", "대표자 이름", "전화번호", "지역", "창업년도"]);
    expect(map).toMatchObject({
      name: "회사명",
      owner_name: "대표자 이름",
      phone: "전화번호",
      region: "지역",
      founded_on: "창업년도",
    });
  });

  it("한국어 일반 헤더와 영문 헤더도 같은 필드로 모인다 — CRM 이 늘어도 별칭만 추가한다", () => {
    expect(resolveHeaderMap(["상호"]).name).toBe("상호");
    expect(resolveHeaderMap(["Company Name"]).name).toBe("Company Name");
    expect(resolveHeaderMap(["연락처"]).phone).toBe("연락처");
  });

  it("★ 못 알아본 헤더를 조용히 버리지 않는다 — 버렸다는 사실을 돌려준다", () => {
    const result = mapCsvToCompanies(
      [{ title: "가나상사", values: { 담당메모: "중요" } }],
      ["이름", "담당메모"],
    );
    expect(result.unrecognized).toContain("담당메모");
    // 조용히 버리면 사용자는 그 값이 들어간 줄 안다
    expect(result.mapped).toHaveLength(1);
  });

  it("회사명이 비면 그 행은 거절하고 줄 번호를 남긴다 — 이름 없는 회사를 만들지 않는다", () => {
    const result = mapCsvToCompanies(
      [
        { title: "", values: { 회사명: "" } },
        { title: "정상상사", values: { 회사명: "정상상사" } },
      ],
      ["회사명"],
    );
    expect(result.rejected).toEqual([{ line: 2, title: "", reason: "회사명이 비어 있습니다" }]);
    expect(result.mapped).toHaveLength(1);
    expect(result.mapped[0].input.name).toBe("정상상사");
  });

  it("헤더의 «회사명» 이 첫 열보다 우선한다", () => {
    const result = mapCsvToCompanies(
      [{ title: "첫열값", values: { 회사명: "진짜상호" } }],
      ["아무개", "회사명"],
    );
    expect(result.mapped[0].input.name).toBe("진짜상호");
  });

  it("숫자로 못 읽는 매출액은 «지어내지 않고» null 이다", () => {
    expect(parseRevenue("1,200")).toBe(1200);
    expect(parseRevenue("3000원")).toBe(3000);
    expect(parseRevenue("1,200만")).toBeNull();
    expect(parseRevenue("약 5억")).toBeNull();
    expect(parseRevenue("")).toBeNull();
    expect(parseRevenue(undefined)).toBeNull();
  });

  it("CSV 숫자는 raw number로 파싱하고 식별 문자열의 선행 0은 보존한다", () => {
    const result = mapCsvToCompanies(
      [{ title: "회사", values: { 전화번호: "001234", 매출액: "1,234.5" } }],
      ["전화번호", "매출액"],
    );

    expect(result.mapped[0].input.phone).toBe("001234");
    expect(result.mapped[0].input.revenue).toBe(1234.5);
  });

  it("창업년도는 연도만 있어도 받고, 못 읽으면 null 이다", () => {
    expect(parseFoundedOn("2024")).toBe("2024-01-01");
    expect(parseFoundedOn("2024.03")).toBe("2024-03-01");
    expect(parseFoundedOn("2024-03-05")).toBe("2024-03-05");
    expect(parseFoundedOn("2024/3/5")).toBe("2024-03-05");
    expect(parseFoundedOn("작년")).toBeNull();
  });

  it("★ 이미 동작하는 파서와 이어붙으면 CSV 텍스트 한 장이 회사 목록이 된다", () => {
    const csv = [
      "회사명,대표자 이름,전화번호,지역,창업년도,매출액",
      "가나상사,홍길동,010-0000-0000,서울,2020,1500",
      "다라물산,김철수,02-000-0000,부산,2018.07,",
    ].join("\n");
    const parsed = parseDeidentifiedCsv(csv);
    expect(parsed.rows).toHaveLength(2);
    const headers = ["회사명", "대표자 이름", "전화번호", "지역", "창업년도", "매출액"];
    const result = mapCsvToCompanies(parsed.rows, headers);
    expect(result.rejected).toHaveLength(0);
    expect(result.mapped.map((row) => row.input.name)).toEqual(["가나상사", "다라물산"]);
    expect(result.mapped[0].input).toMatchObject({
      owner_name: "홍길동", phone: "010-0000-0000", region: "서울",
      founded_on: "2020-01-01", revenue: 1500,
    });
    // 빈 칸은 null 이다 — 빈 문자열로 저장해 «입력됨» 으로 위장하지 않는다
    expect(result.mapped[1].input.revenue).toBeNull();
    expect(result.mapped[1].input.founded_on).toBe("2018-07-01");
  });

  it("행 상한이 025 규약과 같은 500 이다", () => {
    expect(IMPORT_ROW_CAP).toBe(500);
  });
});
