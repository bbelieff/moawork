import { describe, it, expect } from "vitest";
import type { FieldType } from "./domain-types";
import {
  applyView,
  toViewConfig,
  fromViewConfig,
  pickDefaultView,
  type ViewConfig,
  type CellResolver,
} from "./views";

interface Row {
  id: string;
  fields: Record<string, unknown>;
}

const rows: Row[] = [
  { id: "1", fields: { title: "gamma", amount: 30, stage: "opt-a" } },
  { id: "2", fields: { title: "alpha", amount: 10, stage: "opt-b" } },
  { id: "3", fields: { title: "beta", amount: 20, stage: "opt-a" } },
];

const resolve: CellResolver<Row> = (row, key) => (row.fields[key] ?? null) as never;
const lookup = (key: string): FieldType | undefined =>
  key === "amount" ? "number" : key === "stage" ? "select" : "text";

describe("views: adapter roundtrip", () => {
  it("fromViewConfig → toViewConfig preserves config", () => {
    const config: ViewConfig = {
      filters: [{ fieldKey: "stage", operator: "eq", value: "opt-a" }],
      sorts: [{ fieldKey: "amount", direction: "desc" }],
      columns: ["title", "amount"],
    };
    const row = fromViewConfig(config);
    expect(toViewConfig(row)).toEqual(config);
  });
  it("tolerates malformed jsonb", () => {
    const c = toViewConfig({
      filters_jsonb: null,
      sort_jsonb: "x",
      columns_jsonb: [1, "ok"],
    } as unknown as Parameters<typeof toViewConfig>[0]);
    expect(c).toEqual({ filters: [], sorts: [], columns: ["ok"] });
  });
});

describe("views: applyView filter", () => {
  it("filters by select eq", () => {
    const out = applyView(rows, { filters: [{ fieldKey: "stage", operator: "eq", value: "opt-a" }], sorts: [], columns: [] }, resolve, lookup);
    expect(out.map((r) => r.id)).toEqual(["1", "3"]);
  });
  it("numeric gt uses number comparable", () => {
    const out = applyView(rows, { filters: [{ fieldKey: "amount", operator: "gt", value: 15 }], sorts: [], columns: [] }, resolve, lookup);
    expect(out.map((r) => r.id).sort()).toEqual(["1", "3"]);
  });
  it("is_empty on missing key", () => {
    const out = applyView(rows, { filters: [{ fieldKey: "note", operator: "is_empty" }], sorts: [], columns: [] }, resolve, lookup);
    expect(out).toHaveLength(3);
  });
});

describe("views: applyView sort (stable, type-aware)", () => {
  it("sorts numeric asc", () => {
    const out = applyView(rows, { filters: [], sorts: [{ fieldKey: "amount", direction: "asc" }], columns: [] }, resolve, lookup);
    expect(out.map((r) => r.id)).toEqual(["2", "3", "1"]);
  });
  it("sorts text desc", () => {
    const out = applyView(rows, { filters: [], sorts: [{ fieldKey: "title", direction: "desc" }], columns: [] }, resolve, lookup);
    expect(out.map((r) => r.fields.title)).toEqual(["gamma", "beta", "alpha"]);
  });
});

describe("views: pickDefaultView (OQ-4 규약)", () => {
  const v = (id: string, name: string, shared: boolean) => ({ id, name, shared });

  it("빈 목록이면 null", () => {
    expect(pickDefaultView([])).toBeNull();
  });

  it("shared=true 를 최우선 (이름이 뒤여도 공유가 이김)", () => {
    const picked = pickDefaultView([v("id-1", "aaa", false), v("id-2", "zzz", true)]);
    expect(picked?.id).toBe("id-2");
  });

  it("shared 동일하면 name ASC", () => {
    const picked = pickDefaultView([v("id-1", "b", true), v("id-2", "a", true), v("id-3", "c", true)]);
    expect(picked?.name).toBe("a");
  });

  it("shared·name 동일하면 id ASC 로 tie-break (결정적)", () => {
    const picked = pickDefaultView([v("id-9", "same", true), v("id-2", "same", true)]);
    expect(picked?.id).toBe("id-2");
  });

  it("입력 순서에 무관하게 같은 결과 (결정성)", () => {
    const list = [v("id-3", "b", false), v("id-1", "b", true), v("id-2", "a", false)];
    const a = pickDefaultView(list)?.id;
    const b = pickDefaultView([...list].reverse())?.id;
    expect(a).toBe("id-1"); // shared 우선
    expect(b).toBe(a);
  });

  it("sort_order 를 쓰지 않음 — 재정렬해도 기본 뷰 불변", () => {
    // sort_order 를 가진 객체를 넣어도 선택 결과는 shared/name/id 로만 결정된다.
    const list = [
      { ...v("id-1", "a", true), sort_order: 99 },
      { ...v("id-2", "b", true), sort_order: 0 },
    ];
    expect(pickDefaultView(list)?.id).toBe("id-1");
  });

  it("003 board_views 형태에도 그대로 적용 (구조적 타이핑)", () => {
    const boardViews = [
      { id: "bv-2", board_id: "b1", name: "칸반", kind: "kanban", shared: false },
      { id: "bv-1", board_id: "b1", name: "테이블", kind: "table", shared: true },
    ];
    expect(pickDefaultView(boardViews)?.id).toBe("bv-1");
  });
});

describe("views: multiselect contains", () => {
  it("matches when array includes id", () => {
    const msRows: Row[] = [
      { id: "1", fields: { tags: ["opt-a", "opt-b"] } },
      { id: "2", fields: { tags: ["opt-c"] } },
    ];
    const out = applyView(
      msRows,
      { filters: [{ fieldKey: "tags", operator: "contains", value: "opt-b" }], sorts: [], columns: [] },
      (r, k) => (r.fields[k] ?? null) as never,
      () => "multiselect",
    );
    expect(out.map((r) => r.id)).toEqual(["1"]);
  });
});
