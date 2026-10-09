import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ctx } from "@/lib/types";
import { PIPELINES_WITH_STAGES_SELECT, SupabaseCrmError, SupabaseCrmSource } from "./supabaseCrmSource";
import { AsyncCrmService } from "@/lib/crm/asyncService";

function fakeDb(result: { data: unknown; error: unknown }) {
  const ops: Array<[string, ...unknown[]]> = [];
  const builder: Record<string, unknown> = new Proxy({}, {
    get(_target, property) {
      if (property === "then") return (resolve: (value: unknown) => unknown) => Promise.resolve(resolve(result));
      return (...args: unknown[]) => {
        ops.push([String(property), ...args]);
        return builder;
      };
    },
  });
  const from = vi.fn(() => builder);
  return { db: { from } as unknown as SupabaseClient, ops, from };
}

const rows = [
  { id: "p-1", org_id: "org-a", name: "가 파이프라인", stages: [
    { id: "s-1", pipeline_id: "p-1", name: "리드", sort_order: 0, kind: "work" },
    { id: "s-2", pipeline_id: "p-1", name: "계약", sort_order: 1, kind: "work" },
  ] },
  { id: "p-2", org_id: "org-a", name: "나 파이프라인", stages: [] },
];

describe("Issue 857 · 파이프라인과 단계를 한 번에", () => {
  it("외래키 이름을 붙여 묶고, 파이프라인 이름·단계 순서로 정렬한다", async () => {
    expect(PIPELINES_WITH_STAGES_SELECT).toBe(
      "id, org_id, name, stages!stages_pipeline_id_fkey(id, pipeline_id, name, sort_order, kind)",
    );
    const { db, ops, from } = fakeDb({ data: rows, error: null });
    const result = await new SupabaseCrmSource(db).listPipelinesWithStages("org-a");
    expect(from).toHaveBeenCalledWith("pipelines");
    expect(ops).toContainEqual(["select", PIPELINES_WITH_STAGES_SELECT]);
    expect(ops).toContainEqual(["eq", "org_id", "org-a"]);
    expect(ops).toContainEqual(["order", "name"]);
    expect(ops).toContainEqual(["order", "sort_order", { referencedTable: "stages" }]);
    expect(result).toEqual([
      { id: "p-1", org_id: "org-a", name: "가 파이프라인", stages: [
        { id: "s-1", pipeline_id: "p-1", name: "리드", sort_order: 0, kind: "work" },
        { id: "s-2", pipeline_id: "p-1", name: "계약", sort_order: 1, kind: "work" },
      ] },
      { id: "p-2", org_id: "org-a", name: "나 파이프라인", stages: [] },
    ]);
  });

  it("실패는 숨기지 않고 던진다(대시보드는 crm 묶음 «불러오지 못함»)", async () => {
    const { db } = fakeDb({ data: null, error: { message: "denied", code: "42501" } });
    await expect(new SupabaseCrmSource(db).listPipelinesWithStages("org-a")).rejects.toBeInstanceOf(SupabaseCrmError);
  });

  it("서비스는 한 번에 읽는 소스가 있으면 그것을 쓰고, 결과는 파이프라인마다 읽던 것과 같다", async () => {
    const ctx = { org: { id: "org-a" }, user: { id: "u" }, role: "owner", scope: "all" } as Ctx;
    const pipelines = rows.map(({ stages: _stages, ...pipeline }) => pipeline);
    const stagesOf = (id: string) => rows.find((row) => row.id === id)!.stages;
    const legacy = {
      listPipelines: vi.fn(async () => pipelines),
      listStages: vi.fn(async (id: string) => stagesOf(id)),
    };
    const batched = {
      listPipelines: vi.fn(async () => pipelines),
      listStages: vi.fn(async (id: string) => stagesOf(id)),
      listPipelinesWithStages: vi.fn(async () => rows),
    };
    const before = await new AsyncCrmService(legacy as never).listPipelines(ctx);
    const after = await new AsyncCrmService(batched as never).listPipelines(ctx);
    expect(after).toEqual(before);
    expect(batched.listStages).not.toHaveBeenCalled();
    expect(legacy.listStages).toHaveBeenCalledTimes(2);
  });
});
