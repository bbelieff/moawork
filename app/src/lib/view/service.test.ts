import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ViewService, ViewServiceError } from "./service";
import { parseTabView, type TabViewRow } from "./contracts";

/** PostgREST 쿼리 빌더 최소 흉내 — 체인 호출을 기록하고 준비된 응답을 돌려준다. */
type Filter = [string, unknown];

class FakeQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  readonly filters: Filter[] = [];
  inserted: unknown;
  updated: unknown;
  deleted = false;
  constructor(
    private readonly result: { data: unknown; error: unknown },
    private readonly log: { table: string; op: string; filters: Filter[]; payload?: unknown }[],
    private readonly table: string,
  ) {}
  select() {
    return this;
  }
  insert(payload: unknown) {
    this.inserted = payload;
    return this;
  }
  update(payload: unknown) {
    this.updated = payload;
    return this;
  }
  delete() {
    this.deleted = true;
    return this;
  }
  eq(k: string, v: unknown) {
    this.filters.push([k, v]);
    return this;
  }
  order() {
    return this;
  }
  single() {
    return this.settle();
  }
  private settle() {
    const op = this.inserted ? "insert" : this.updated ? "update" : this.deleted ? "delete" : "select";
    this.log.push({ table: this.table, op, filters: this.filters, payload: this.inserted ?? this.updated });
    return Promise.resolve(this.result);
  }
  then<A, B = never>(
    onOk?: ((v: { data: unknown; error: unknown }) => A | PromiseLike<A>) | null,
    onErr?: ((r: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.settle().then(onOk, onErr);
  }
}

function fakeDb(result: { data: unknown; error?: unknown }) {
  const log: { table: string; op: string; filters: Filter[]; payload?: unknown }[] = [];
  const db = {
    from(table: string) {
      return new FakeQuery({ data: result.data, error: result.error ?? null }, log, table);
    },
  } as unknown as SupabaseClient;
  return { db, log };
}

const ROW: TabViewRow = {
  id: "view-1",
  org_id: "org-1",
  board_key: "new",
  owner_id: "user-1",
  name: "오늘 통화할 곳",
  kind: "flat",
  visibility: "private",
  person_scope: "none",
  person_scope_user_id: null,
  filters_jsonb: { 상담상황: ["상담 전"] },
  sort_jsonb: [],
  hidden_columns_jsonb: [],
  column_order_jsonb: [],
  calendar_field_key: null,
  created_at: "2026-08-11T00:00:00Z",
  updated_at: "2026-08-11T00:00:00Z",
};

describe("ViewService.list", () => {
  it("org_id · board_key 로 좁혀 조회하고 도메인 형으로 변환한다", async () => {
    const { db, log } = fakeDb({ data: [ROW] });
    const svc = new ViewService(db);
    const views = await svc.list("org-1", "new");
    expect(views).toHaveLength(1);
    expect(views[0].name).toBe("오늘 통화할 곳");
    expect(log[0]).toMatchObject({ table: "tab_views", filters: [["org_id", "org-1"], ["board_key", "new"]] });
  });

  it("형식이 깨진 row는 목록에서 건너뛴다(전체 실패시키지 않는다)", async () => {
    const broken = { ...ROW, kind: "unknown-kind" };
    const { db } = fakeDb({ data: [ROW, broken] });
    const svc = new ViewService(db);
    const views = await svc.list("org-1", "new");
    expect(views).toHaveLength(1);
  });

  it("PostgREST 오류는 ViewServiceError로 올린다", async () => {
    const { db } = fakeDb({ data: null, error: { message: "boom", code: "500" } });
    const svc = new ViewService(db);
    await expect(svc.list("org-1", "new")).rejects.toBeInstanceOf(ViewServiceError);
  });
});

describe("ViewService.create", () => {
  it("입력을 snake_case row로 변환해 insert한다", async () => {
    const { db, log } = fakeDb({ data: ROW });
    const svc = new ViewService(db);
    await svc.create({
      orgId: "org-1",
      boardKey: "new",
      ownerId: "user-1",
      name: "오늘 통화할 곳",
      kind: "flat",
      visibility: "private",
      personScope: "none",
      filters: { 상담상황: ["상담 전"] },
    });
    expect(log[0].payload).toMatchObject({
      org_id: "org-1",
      board_key: "new",
      owner_id: "user-1",
      kind: "flat",
      visibility: "private",
      person_scope: "none",
      filters_jsonb: { 상담상황: ["상담 전"] },
    });
  });
});

describe("ViewService.duplicate", () => {
  it("복제본은 이름에 «사본»이 붙고 항상 private다", async () => {
    const { db, log } = fakeDb({ data: { ...ROW, name: "오늘 통화할 곳 사본", visibility: "private" } });
    const svc = new ViewService(db);
    const parsedOriginal = parseTabView({ ...ROW, visibility: "shared" });
    if (!parsedOriginal) throw new Error("fixture parse failed");
    await svc.duplicate(parsedOriginal, "user-2");
    expect(log[0].payload).toMatchObject({ name: "오늘 통화할 곳 사본", visibility: "private", owner_id: "user-2" });
  });
});

describe("ViewService.remove", () => {
  it("id로 delete한다", async () => {
    const { db, log } = fakeDb({ data: null });
    const svc = new ViewService(db);
    await svc.remove("view-1");
    expect(log[0]).toMatchObject({ table: "tab_views", op: "delete", filters: [["id", "view-1"]] });
  });
});
