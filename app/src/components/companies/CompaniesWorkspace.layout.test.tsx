import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CompaniesWorkspace } from "./CompaniesWorkspace";
import { COMPANY_STATUS_COLUMNS } from "@/lib/companies/status";
import type { CompaniesViewModel } from "@/lib/companies/server";

/**
 * #531 「업체관리 현황」 **배치 계약**.
 *
 * 무엇을 재는가 — 「있어야 할 자리에 그것이 있는가」
 *   ① 존재: 목업이 그린 것이 실제 HTML 에 나오는가
 *   ② 순서: 왼쪽에서 오른쪽으로 목업과 같은 차례인가
 *   ③ 세로 순서: KPI → 필터 → 패널 제목 → 표 순인가
 *   ④ 시각 속성: 첫 열 고정·가로 스크롤처럼 «보기» 를 좌우하는 것이 붙어 있는가
 *
 * 무엇을 못 재는가 — 여백·색·글꼴·반응형 붕괴·요소 겹침.
 *   그건 완주 전 «눈으로 한 번» 이 맡는다. 이 테스트는 그 눈검사를 대신하지 않는다.
 */

const company = {
  id: "company-1", org_id: "org-1", name: "가나상사", biz_type: null, region: "서울",
  owner_name: "대표", phone: null, email: null, revenue: null, founded_on: null,
  homepage: null, assigned_to: null, created_at: "2026-01-01T00:00:00.000Z",
};

const deal = {
  id: "deal-1", org_id: "org-1", company_id: "company-1", title: "운전자금",
  pipeline_id: null, stage_id: "stage-1", assigned_to: "user-1", amount: 50_000_000,
  custom: {}, status_note: null, fee_terms: "실행액의 3% · 부가세 별도",
  applied_on: "2026-03-04", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
};

const model: CompaniesViewModel = {
  status: "ready",
  dealsStatus: "ready",
  companies: [
    {
      company,
      deals: [
        {
          deal,
          ledger: { status: "ready", total: 6_000_000, received: 1_000_000, outstanding: 5_000_000, fee: 5_000_000 },
          money: {
            contractDeposit: 1_000_000, contractDepositPaidOn: "2026-03-10",
            fee: 5_000_000, feeBilledOn: "2026-05-02", feePaidOn: null,
            ledgerTotal: 6_000_000, outstanding: 5_000_000,
          },
          ownerName: "담당A",
          statusLabel: "승인",
          // #531 — 진행기관·승인일은 계약업체 실무 보드에서 읽어 온다.
          boardFacts: { institution: "기술보증기금", approvedOn: "2026-04-18" },
        },
      ],
    },
  ],
} as CompaniesViewModel;

const html = renderToStaticMarkup(<CompaniesWorkspace model={model} />);

/** 라벨이 «텍스트 노드로» 나온 자리. 클래스명 안의 우연한 일치를 잡지 않으려고 `>` `<` 로 감싼다. */
const at = (label: string) => html.indexOf(`>${label}<`);

/**
 * 표 머리만 잘라 낸 조각.
 *
 * ★ 왜 필요한가 — «담당자» 는 필터 칩에도 있고 표 머리에도 있다. 문서 전체에서 첫 자리를
 *   찾으면 필터 쪽이 잡혀서 열 순서가 뒤죽박죽으로 보인다. 열 순서를 재려면 열만 봐야 한다.
 */
const head = html.slice(html.indexOf("<thead"), html.indexOf("</thead>"));
const atHead = (label: string) => head.indexOf(`>${label}<`);

describe("#531 업체관리 현황 — 배치 계약", () => {
  it("① 13개 열이 전부 존재한다", () => {
    expect(COMPANY_STATUS_COLUMNS).toHaveLength(13);
    for (const column of COMPANY_STATUS_COLUMNS) {
      expect(atHead(column.label), `«${column.label}» 열이 렌더되지 않았다`).toBeGreaterThan(-1);
    }
  });

  it("② 13개 열이 목업의 좌→우 순서 그대로다", () => {
    const positions = COMPANY_STATUS_COLUMNS.map((column) => atHead(column.label));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("② 8번째 열은 «계약조건» 이고 «수수료율» 은 어디에도 없다", () => {
    // 총괄 직접 지시(2026-08-24): 수수료를 %로 굳히지 않고 계약조건 자유기재로 둔다.
    // CLAUDE.md 「기준의 우선순위」 1번이 2번(목업)을 이기는 자리라서, 목업과 다른 것이 정답이다.
    expect(COMPANY_STATUS_COLUMNS[7].label).toBe("계약조건");
    expect(html).not.toContain("수수료율");
    // 자유기재한 내용이 그대로 보여야 한다 — 숫자로 깎지 않는다.
    expect(html).toContain("실행액의 3% · 부가세 별도");
  });

  it("① KPI 5개가 목업 순서대로 있다", () => {
    const kpis = ["업체", "자금 건", "누적 실행액", "누적 수수료", "미수금"];
    const positions = kpis.map(at);
    for (const [index, position] of positions.entries()) {
      expect(position, `KPI «${kpis[index]}» 가 없다`).toBeGreaterThan(-1);
    }
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("① 필터 6개가 목업 순서대로 있다", () => {
    const filters = ["회사명 검색", "담당자", "진행 상태", "미수금만", "모두 펼치기", "모두 접기"];
    const positions = filters.map(at);
    for (const [index, position] of positions.entries()) {
      expect(position, `필터 «${filters[index]}» 가 없다`).toBeGreaterThan(-1);
    }
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("③ 세로 순서: 제목 → KPI → 필터 → 패널 제목 → 표 머리", () => {
    const order = [
      at("업체관리 현황"),
      at("누적 실행액"),      // KPI 줄
      at("모두 접기"),        // 필터 줄의 마지막
      at("업체 · 자금 건"),   // 패널 제목
      at("회사 · 자금명"),    // 표의 첫 열 머리
    ];
    for (const position of order) expect(position).toBeGreaterThan(-1);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("④ 첫 열은 가로 스크롤 중에도 고정되고, 표만 옆으로 움직인다", () => {
    expect(html).toContain("sticky left-0");
    expect(html).toContain("overflow-x-auto");
  });

  it("④ 회사 1행 · 접힌 상태의 자금 건은 «감춰지되 문서에는 남는다»", () => {
    // 목업 부제의 «회사 1행 · 펼치면 자금 건별 이력» 그대로다.
    expect(html).toContain("가나상사");
    expect(html).toContain("1건");
    // 자금 건 행은 hidden 이다 — 보이지 않지만 지워지지도 않는다.
    // (예전 `<details>` 가 갖고 있던 성질. 브라우저 찾기가 여전히 걸린다.)
    const dealRow = html.slice(html.indexOf("<tr hidden"));
    expect(dealRow).toContain("운전자금");
    expect(html.indexOf("<tr hidden")).toBeGreaterThan(-1);
  });

  it("④ 자금 건 한 줄의 값이 13열 순서 그대로 들어간다", () => {
    const row = html.slice(html.indexOf("운전자금"));
    // 값이 있는 칸들이 목업의 좌→우 차례 그대로 나온다.
    // #531 — 진행기관·승인일이 «자리에» 들어왔다. 예전에는 이 둘이 «—» 였다.
    const values = ["기술보증기금", "담당A", "승인", "26-03-04", "26-04-18", "50,000,000원", "실행액의 3% · 부가세 별도", "1,000,000원", "26-03-10", "5,000,000원", "26-05-02"];
    const positions = values.map((value) => row.indexOf(value));
    for (const [index, position] of positions.entries()) {
      expect(position, `«${values[index]}» 가 자금 건 줄에 없다`).toBeGreaterThan(-1);
    }
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("④ 회사 줄은 «건들을 접은 값» 이다 — 회사 속성을 남의 칸에 넣지 않는다", () => {
    // ★ 실제로 한 번 틀렸던 자리다: 지역(서울)을 «진행기관» 칸에, 대표자를 «담당자» 칸에 넣었었다.
    //   목업은 그 둘을 열이 아니라 **첫 칸 아래 작은 줄**(대표 · 업종 · 지역)에 붙인다.
    const row = html.slice(html.indexOf('scope="row"'));
    const firstCell = row.slice(0, row.indexOf("</th>"));

    // 대표·지역은 첫 칸 안에 있다.
    expect(firstCell).toContain("가나상사");
    expect(firstCell).toContain("대표 · 서울");
    expect(firstCell).toContain("자금 1건");

    // 그 뒤 칸들에는 회사 속성이 아니라 건들을 접은 값이 온다.
    const rest = row.slice(row.indexOf("</th>"));
    expect(rest, "지역이 회사 줄의 다른 칸으로 새어 나갔다").not.toContain("서울");
    expect(rest).toContain("담당A");      // 담당자 칸 = 건들의 담당자
    expect(rest).toContain("승인 1");     // 상태 칸 = 승인 건수 배지
    expect(rest).toContain("26-03-04");   // 착수 칸 = 가장 이른 착수일
    expect(rest).toContain("미수 5,000,000원");
  });

  it("네이티브 select 를 쓰지 않는다(집안 규약 — 칩+팝오버)", () => {
    expect(html).not.toContain("<select");
    expect(html).toContain("<details");
  });
});
