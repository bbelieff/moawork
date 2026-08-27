/**
 * 기본 탭 «신규리드» ↔ 목업 v6 기계 대조 — BBE-145.
 *
 * **사람이 옮겨 적은 값을 믿지 않는다.** 목업 HTML 에서 계약을 뽑는 함수
 * `extractMockupContract()`(docs/design/dump-mockup.mjs · BBE-140 이 export 로 열어 둔 API)를
 * 직접 불러 내 정의와 맞대 본다. 목업이 바뀌면 이 테스트가 먼저 깨진다.
 *
 * ── 왜 `qa-app.mjs` 로 재지 않는가 ──
 * `qa-app.mjs` 는 앱 쪽 정본으로 `migration/monday-mapping/policyfund-pack.ts` 를 읽는다(하드코딩된 경로).
 * 그 팩은 **먼데이 실측 아카이브**라 내가 고칠 수 없다(`policyfund-pack.test.ts` 가 컬럼 수를
 * [24,21,24] 로 못박고 마이그레이션 040 과 대조한다 · AGENTS.md §9.1 «기존 마이그레이션 수정 금지»).
 * 그래서 이 카드의 산출물은 qa-app 의 175 를 움직이지 못한다 — 재는 자가 다른 물건을 보고 있다.
 * qa-app 가 기본 탭도 읽게 넓히는 것은 **NG-02(BBE-140) 소유**라 손대지 않았다. 인계 사항이다.
 * 그 대신 «목업과 같은가» 를 여기서 같은 계약 API 로 직접 강제한다.
 */

import { describe, expect, it } from "vitest";
// docs 의 순수 ESM 스크립트를 그대로 부른다(BBE-140 이 export 로 열어 둔 API).
// 반환 타입은 아래 MockTab 으로 좁혀 쓴다 — 타입 선언 파일을 만들지 않는다(그 파일은 NG-02 소유).
import { extractMockupContract } from "../../../../docs/design/dump-mockup.mjs";
import { isSourceEditable } from "@/lib/field/source";
import {
  durableNewLeadColumnKeys,
  durableNewLeadDetailLayout,
  NEW_LEAD_COMPOSITE_PRESENTATION_COLUMNS,
  NEW_LEAD_TAB,
  presentNewLeadColumnKeys,
  presentNewLeadColumns,
  presentNewLeadDetailLayout,
  presentNewLeadUnplacedKeys,
  SEND_PENDING_REASON,
} from "./new-lead";
import type { BoardColumn } from "@/lib/boards/types";
import { moveDetailEntry } from "@/lib/boards/detail-layout";
import type { DefaultTabColumn } from "./types";

interface MockColumn {
  label: string;
  type: string;
  source: string;
  options: string[];
}
interface MockTab {
  key: string;
  label: string;
  groups: string[];
  columns: MockColumn[];
  moves: { column: string; value: string; group: string }[];
  transitions: { column: string; value: string; to: string; guard: unknown }[];
}

const mock: MockTab = (
  extractMockupContract() as { tabs: MockTab[] }
).tabs.find((tab) => tab.key === "new")!;

/** 목업 타입 어휘 → 앱 `FieldType`. 나머지 8종은 이름이 같다. */
const TYPE_MAP: Record<string, string> = { sel: "select", dt: "datetime" };
const mockType = (type: string) => TYPE_MAP[type] ?? type;

const byLabel = new Map(NEW_LEAD_TAB.columns.map((column) => [column.label, column]));
byLabel.set("협업자", NEW_LEAD_TAB.columns.find((column) => column.key === "collaborators")!);
byLabel.set("매출 구간", NEW_LEAD_TAB.columns.find((column) => column.key === "revenue_band")!);
byLabel.set("광고 명", NEW_LEAD_TAB.columns.find((column) => column.key === "ad_name")!);
byLabel.set("사업자 유형", NEW_LEAD_TAB.columns.find((column) => column.key === "biz_reg_type")!);
byLabel.set("업종/업태", NEW_LEAD_TAB.columns.find((column) => column.key === "industry")!);

/**
 * 목업과 다르기로 «결정한» 곳. 근거 없이 다른 것은 여기 못 들어온다.
 * 이 목록에 없는 차이가 생기면 아래 테스트가 실패한다.
 */
const DELIBERATE_OPTION_DIFFS: Record<string, string> = {
  "부재 안내": "목업 첫 항목의 빈 라벨은 선택지가 아니라 «값 없음(null)» 이다. validation 이 빈 라벨을 거부한다",
  담당자: "D71~D75 — 사람 이름은 예시다. 값은 워크스페이스 멤버 계정에서 온다",
  협업자: "최신 사용자 어휘는 연관담당이며 목업의 협업자와 같은 durable key를 쓴다",
  시군구: "목업 12개는 샘플 잔재. 실측 지역 사전(222지)에서 시군구를 뽑아 쓴다. 종속 선택은 BBE-127",
  "매출 구간": "목업이 선택지를 비워 뒀다. 구간 기준은 회사가 정한다 — 지어내면 남의 회사 기준이 박힌다",
  "상담 상황": "상세 진입 없이 표에서 바로 리드컨택으로 넘기는 최신 사용자 확정 선택지를 추가했다",
};

const DELIBERATE_TYPE_DIFFS: Record<string, string> = {
  "매출 구간": "자동 유입 때 받은 구간은 그대로 보존하되 상담 뒤 실제 3개년 매출을 자유롭게 고칠 수 있어야 한다",
  "사업자 유형": "개인·법인 외 유형도 사용자가 직접 입력할 수 있어야 한다는 최신 사용자 확정",
};

describe("신규리드 기본 탭 ↔ 목업 v6 (기계 대조)", () => {
  it("목업 계약을 실제로 읽어 왔다 — 빈 껍데기로 통과하지 않는다", () => {
    expect(mock).toBeDefined();
    expect(mock.label).toBe("신규리드 관리");
    expect(mock.columns.length).toBe(22);
  });

  it("그룹 5개는 사용자 확정 순서가 목업보다 우선한다", () => {
    expect(NEW_LEAD_TAB.groups.map((group) => group.name)).toEqual([
      "💡 신규고객", "🔍 2차 상담고객", "🔇 1차 부재", "📑 보류", "🚫 거절",
    ]);
  });

  it("실제 운영 먼데이의 비AI 업무 컬럼을 보강하고 광고 명을 유입정보 앞단에 둔다", () => {
    const labels = NEW_LEAD_TAB.columns.map((column) => column.label);
    expect(labels).toHaveLength(40);
    expect(labels).toEqual(expect.arrayContaining(mock.columns.map((column) => {
      if (column.label === "협업자") return "연관담당";
      if (column.label === "매출 구간") return "3개년매출";
      if (column.label === "광고 명") return "광고명";
      if (column.label === "사업자 유형") return "사업자유형";
      if (column.label === "업종/업태") return "업종";
      return column.label;
    })));
    expect(labels).toEqual(expect.arrayContaining([
      "주소", "파일", "상담내용", "연관담당", "출동", "컨택여부", "상담지연 메시지", "악성부재 메시지전달",
      "기대출", "기대출 상세(반복)", "NCB", "KCB", "기타정보",
    ]));
    expect(labels.indexOf("광고명")).toBeLessThan(labels.indexOf("연락처"));
  });

  it("컬럼 타입이 목업과 같다", () => {
    for (const column of mock.columns) {
      if (DELIBERATE_TYPE_DIFFS[column.label]) {
        expect(byLabel.get(column.label)?.type, `${column.label} 는 근거 있는 차이여야 한다`).toBe("text");
        continue;
      }
      expect(byLabel.get(column.label)?.type, column.label).toBe(mockType(column.type));
    }
  });

  it("컬럼 출처(✎⟳⇄ƒ✉)가 목업과 같다 — 편집 가능 여부가 여기서 나온다", () => {
    const userConfirmedSourceChanges = new Set(["광고 명", "업종/업태", "시군구", "이메일", "주소"]);
    for (const column of mock.columns) {
      if (userConfirmedSourceChanges.has(column.label)) continue;
      expect(byLabel.get(column.label)?.source, column.label).toBe(column.source);
    }
  });

  it("선택지가 목업과 같다 — 다른 곳은 근거가 등록된 5곳뿐이다", () => {
    for (const column of mock.columns) {
      const mine = byLabel.get(column.label)!;
      const mineLabels = (mine.options ?? []).map((option) => option.label);
      if (DELIBERATE_OPTION_DIFFS[column.label]) {
        expect(mineLabels, `${column.label} 는 근거 있는 차이여야 한다`).not.toEqual(column.options);
        continue;
      }
      expect(mineLabels, column.label).toEqual(column.options);
    }
  });

  it("자동 이동은 «상담 상황» 6규칙이고 목업 MOVE2 와 같다", () => {
    const mine = NEW_LEAD_TAB.columns.flatMap((column) =>
      Object.entries(column.moveTo ?? {}).map(([value, group]) => `${column.label}=${value}→${group}`),
    );
    const theirs = mock.moves
      .filter((move) => move.column === "상담 상황")
      .map((move) => `${move.column}=${move.value}→${move.group}`);
    expect(new Set(mine)).toEqual(new Set(theirs));
    expect(mine.length).toBe(6);
  });

  /**
   * ★ 의도적 감시선(tripwire) — 이 테스트가 «실패» 하면 그건 좋은 소식이다.
   *
   * 추출기가 `MOVE.new`(상담 상황 값)를 맨 오른쪽 고정 열 «컨택 이동» 의 규칙으로 잘못 돌려서
   * 계약에 유령 규칙 4개가 섞여 있다(new-lead.ts 머리말 ⚠). 그 4개가 «컨택 이동에 없는
   * 선택지» 를 가리킨다는 사실 자체를 여기 고정해 둔다.
   *
   * NG-02(BBE-140)가 추출기를 고치면 이 테스트가 깨진다 → 그때 이 블록과
   * new-lead.ts 머리말 ⚠ 를 같이 지우면 된다. 조용히 넘어가지 않게 하는 장치다.
   */
  it("[감시선] 추출기는 «컨택 이동» 유령 규칙을 보고하지 않는다", () => {
    const pinnedMoves = mock.moves.filter((move) => move.column === "컨택 이동");
    expect(pinnedMoves.length, "BBE-140 추출기 정본은 유령 규칙을 보고하지 않는다").toBe(0);

    const realOptions = new Set(
      (byLabel.get("컨택 이동")!.options ?? []).map((option) => option.id),
    );
    const phantom = pinnedMoves.filter((move) => !realOptions.has(move.value));
    expect(phantom).toEqual([]);

    // 그리고 그 값들은 전부 «상담 상황» 의 선택지다 — 컬럼이 잘못 붙었다는 증거.
    const consultOptions = new Set(
      (byLabel.get("상담 상황")!.options ?? []).map((option) => option.id),
    );
    for (const move of pinnedMoves) expect(consultOptions.has(move.value), move.value).toBe(true);
  });

  it("이동 규칙의 목표 그룹은 실재하는 그룹이다 — 오타면 카드가 사라진다", () => {
    const groups = new Set(NEW_LEAD_TAB.groups.map((group) => group.name));
    for (const column of NEW_LEAD_TAB.columns) {
      for (const target of Object.values(column.moveTo ?? {})) {
        expect(groups.has(target), `${column.label} → ${target}`).toBe(true);
      }
    }
  });

  it("이동 규칙이 가리키는 선택지는 그 컬럼에 실재한다", () => {
    for (const column of NEW_LEAD_TAB.columns) {
      const ids = new Set((column.options ?? []).map((option) => option.id));
      for (const value of Object.keys(column.moveTo ?? {})) {
        expect(ids.has(value), `${column.label} 선택지 ${value}`).toBe(true);
      }
    }
  });

  it("맨 오른쪽 고정 열은 «컨택 이동» 하나뿐이고 마지막 컬럼이다", () => {
    const pinned = NEW_LEAD_TAB.columns.filter((column) => column.rightPinned);
    expect(pinned.map((column) => column.label)).toEqual(["컨택 이동"]);
    expect(NEW_LEAD_TAB.columns.at(-1)?.label).toBe("컨택 이동");
  });

  it("표의 상담 상황과 오른쪽 고정 관문 양쪽에서 같은 리드컨택 전환을 제공한다", () => {
    expect(NEW_LEAD_TAB.transitions).toEqual([
      { columnKey: "consult_status", value: "리드컨택으로 넘기기", to: "contact", guard: null },
      { columnKey: "contact_move", value: "컨택 이동", to: "contact", guard: null },
    ]);
  });
});

describe("제품 규칙 — 목업을 그대로 옮기면 안 되는 곳", () => {
  it("revision 6은 기타정보 물리 열을 additive로 추가하고 revision 5를 선행 정본으로 남긴다", () => {
    expect(NEW_LEAD_TAB.revision).toBe(6);
    expect(NEW_LEAD_TAB.previousRevision).toEqual({
      revision: 5,
      columns: {},
    });
  });

  it("#602는 revenue 물리 열만 추가하고 신용점수는 durable 두 키를 한 presentation 셀로 둔다", () => {
    expect(NEW_LEAD_COMPOSITE_PRESENTATION_COLUMNS).toEqual([
      expect.objectContaining({ key: "credit_scores", label: "신용점수", type: "text" }),
      expect.objectContaining({ key: "revenue_3y_million", label: "3개년매출(백만원)", type: "number" }),
    ]);
    expect(NEW_LEAD_TAB.columns.some((column) => column.key === "revenue_band")).toBe(true);
    expect(NEW_LEAD_TAB.columns.some((column) => column.key === "credit_score_ncb")).toBe(true);
    expect(NEW_LEAD_TAB.columns.some((column) => column.key === "credit_score_kcb")).toBe(true);
    expect(NEW_LEAD_TAB.columns.some((column) => column.key === "credit_scores")).toBe(false);
    expect(NEW_LEAD_TAB.columns.filter((column) => column.key === "revenue_3y_million")).toHaveLength(1);
  });

  it("표·저장 뷰·상세 alias는 한 칸으로 읽고 서버 저장에는 physical key만 쓴다", () => {
    const physical = NEW_LEAD_TAB.columns.map((definition, index) => ({
      ...definition,
      id: `column-${definition.key}`,
      org_id: "org-a",
      board_id: "board-a",
      rightPinned: Boolean(definition.rightPinned),
      options_jsonb: null,
      sort_order: index,
      width: definition.width ?? null,
    })) as BoardColumn[];
    const presented = presentNewLeadColumns(physical);
    expect(presented.filter((column) => column.key === "credit_scores")).toHaveLength(1);
    expect(presented.filter((column) => column.key === "revenue_3y_million")).toHaveLength(1);
    expect(presented.filter((column) => column.key === "other_info")).toHaveLength(1);
    expect(presented.some((column) => column.key === "credit_score_ncb" || column.key === "credit_score_kcb" || column.key === "revenue_band" || column.key === "closed_business" || column.key === "export_status")).toBe(false);
    expect(presentNewLeadColumnKeys(["credit_score_ncb", "credit_score_kcb", "revenue_band", "revenue_3y_million", "closed_business", "export_status", "other_info"]))
      .toEqual(["credit_scores", "revenue_3y_million", "other_info"]);
    expect(durableNewLeadColumnKeys(["credit_scores", "revenue_3y_million", "other_info"]))
      .toEqual(["credit_score_ncb", "credit_score_kcb", "revenue_band", "revenue_3y_million", "closed_business", "export_status", "other_info"]);

    const physicalLayout = [
      { key: "credit_score_ncb", source: "column" as const, label: "회사 NCB", type: "number" as const },
      { key: "credit_score_kcb", source: "column" as const, label: "회사 KCB", type: "number" as const },
      { key: "memo", source: "detail" as const, label: "회사 메모", type: "text" as const },
      { key: "revenue_band", source: "column" as const, label: "기존 매출 구간", type: "text" as const },
      { key: "revenue_3y_million", source: "column" as const, label: "실제 매출", type: "number" as const },
    ];
    const layout = presentNewLeadDetailLayout(physicalLayout);
    expect(layout.map((entry) => entry.key)).toEqual(["credit_scores", "memo", "revenue_3y_million"]);
    const moved = moveDetailEntry(layout, "revenue_3y_million", -1);
    const durable = durableNewLeadDetailLayout(moved, physicalLayout);
    expect(durable.map((entry) => entry.key)).toEqual([
      "credit_score_ncb", "credit_score_kcb", "revenue_band", "revenue_3y_million", "memo",
    ]);
    expect(durable.slice(0, 2).map((entry) => entry.label)).toEqual(["회사 NCB", "회사 KCB"]);
    expect(durable.slice(2, 4).map((entry) => entry.label)).toEqual(["기존 매출 구간", "실제 매출"]);
    expect(presentNewLeadDetailLayout(durable).map((entry) => entry.key))
      .toEqual(["credit_scores", "revenue_3y_million", "memo"]);
    const withoutCredit = durableNewLeadDetailLayout(
      moved.filter((entry) => entry.key !== "credit_scores"),
      physicalLayout,
    );
    expect(withoutCredit.some((entry) => entry.key === "credit_score_ncb" || entry.key === "credit_score_kcb"))
      .toBe(false);
    expect(durableNewLeadDetailLayout(presentNewLeadDetailLayout(durable), durable))
      .toEqual(durable);
    expect(presentNewLeadUnplacedKeys(
      ["credit_score_ncb", "credit_score_kcb", "revenue_band", "revenue_3y_million"],
      ["credit_scores", "revenue_3y_million"],
    )).toEqual([]);
    expect(presentNewLeadUnplacedKeys(
      ["credit_score_ncb", "credit_score_kcb", "revenue_band", "revenue_3y_million"],
      [],
    )).toEqual(["credit_scores", "revenue_3y_million"]);
  });

  it("부분 repair에서 structured 열이 없으면 legacy 폐업/수출 열을 숨기지 않는다", () => {
    const physical = NEW_LEAD_TAB.columns
      .filter((definition) => definition.key !== "other_info")
      .map((definition, index) => ({
        ...definition,
        id: `column-${definition.key}`,
        org_id: "org-a",
        board_id: "board-a",
        rightPinned: Boolean(definition.rightPinned),
        options_jsonb: null,
        sort_order: index,
        width: definition.width ?? null,
      })) as BoardColumn[];
    const keys = presentNewLeadColumns(physical).map((column) => column.key);
    expect(keys).toContain("closed_business");
    expect(keys).toContain("export_status");
    expect(keys).not.toContain("other_info");
    const partialLayout = [
      { key: "closed_business", source: "column" as const, label: "폐업여부", type: "select" as const },
      { key: "export_status", source: "column" as const, label: "수출여부", type: "select" as const },
    ];
    expect(presentNewLeadDetailLayout(partialLayout).map((entry) => entry.key))
      .toEqual(["closed_business", "export_status"]);
    expect(presentNewLeadUnplacedKeys(["closed_business", "export_status"], []))
      .toEqual(["closed_business", "export_status"]);
  });
  it("D71~D75 — 사람 컬럼에 이름을 박지 않는다. 값은 멤버 계정에서 온다", () => {
    for (const column of NEW_LEAD_TAB.columns) {
      if (column.type === "person" || column.type === "people") {
        expect(column.options, column.label).toBeUndefined();
      }
    }
  });

  it("D71~D75 — 어떤 선택지에도 목업의 예시 사람 이름이 없다", () => {
    const examples = ["카뮈", "이대표", "박정화 실장", "김수현", "이서준", "조은혜"];
    const all = NEW_LEAD_TAB.columns.flatMap((column) => (column.options ?? []).map((option) => option.label));
    for (const name of examples) expect(all, name).not.toContain(name);
  });

  it("✉ 발송 5칸은 안전장치가 올 때까지 잠겨 있다 — 돈이 나가는 칸이다", () => {
    const send = NEW_LEAD_TAB.columns.filter((column) => column.source === "msg");
    expect(send.map((column) => column.label)).toEqual([
      "부재 안내", "1차 상담 안내", "2차 확정 안내", "상담지연 메시지", "악성부재 메시지전달",
    ]);
    for (const column of send) {
      expect(column.readOnly, `${column.label} 잠금`).toBe(true);
      expect(column.pendingReason).toBe(SEND_PENDING_REASON);
      // 구조는 남아 있어야 한다 — 잠근 것이지 지운 것이 아니다(D73).
      expect((column.options ?? []).length, `${column.label} 선택지`).toBeGreaterThan(0);
    }
  });

  it("잠금은 «임시» 다 — 출처 자체는 편집 가능한 msg 로 남아 있어 BBE-148 이 풀 수 있다", () => {
    const send = NEW_LEAD_TAB.columns.filter((column) => column.source === "msg");
    for (const column of send) expect(isSourceEditable(column.source)).toBe(true);
  });

  it("컬럼 key 는 유일하다 — item_values.column_key 가 이걸 참조한다", () => {
    const keys = NEW_LEAD_TAB.columns.map((column: DefaultTabColumn) => column.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("select/status 컬럼은 선택지가 1개 이상이다 — 앱 검증기가 요구한다", () => {
    for (const column of NEW_LEAD_TAB.columns) {
      if (column.type === "select" || column.type === "multiselect" || column.type === "status") {
        expect((column.options ?? []).length, column.label).toBeGreaterThan(0);
      }
    }
  });

  it("선택지 라벨은 비어 있지 않다 — parseOptions 가 빈 라벨을 거부한다", () => {
    for (const column of NEW_LEAD_TAB.columns) {
      for (const option of column.options ?? []) expect(option.label.trim(), column.label).not.toBe("");
    }
  });
});
