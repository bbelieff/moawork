import { describe, expect, it } from "vitest";
import type { Ctx } from "@/lib/types";
import type { BoardColumn } from "@/lib/boards/types";
import { LocalBoardsRepo } from "@/lib/repo/local/boardsRepo";
import {
  ColumnTemplateRepo,
  columnTemplateSource,
  parseColumnTemplateSource,
  previewColumnTemplate,
  type ColumnTemplateBoardsRepo,
} from "./column-template";

function ctx(orgId: string, userId: string, role: Ctx["role"] = "owner"): Ctx {
  return {
    org: { id: orgId, name: "격리 회사", plan_tier: "test", created_at: "2026-08-21T00:00:00Z" },
    user: { id: userId, email: null, name: "사용자", avatar_url: null, created_at: "2026-08-21T00:00:00Z" },
    role, scope: "all", isPlatformAdmin: false,
  };
}

function column(over: Partial<BoardColumn> = {}): BoardColumn {
  return {
    id: "column-a", org_id: "org-a", board_id: "board-a", key: "status", label: "상태",
    type: "select", source: "in", rightPinned: false,
    options_jsonb: { options: [{ id: "ready", label: "준비" }] }, sort_order: 0,
    width: 160, move_rule_jsonb: null, is_readonly: false, ...over,
  };
}

describe("컬럼 템플릿 계약", () => {
  it("source에 조직 고객값 없이 소유·공개범위·버전·멱등 요청을 왕복한다", () => {
    const source = columnTemplateSource({ templateKey: "template-a", scope: "private", ownerId: "user-a", version: 3, requestId: "request-a" });
    expect(parseColumnTemplateSource(source)).toEqual({ templateKey: "template-a", scope: "private", ownerId: "user-a", version: 3, requestId: "request-a" });
    expect(source).not.toContain("org-a");
    expect(source).not.toContain("item_values");
  });

  it("동일 request replay는 버전 보드를 하나만 만들고 타 조직에는 0개다", async () => {
    const boards = new LocalBoardsRepo();
    const repo = new ColumnTemplateRepo(boards as unknown as ColumnTemplateBoardsRepo);
    const owner = ctx("org-version", "user-version");
    const input = { templateKey: "template-a", name: "상태 구조", scope: "private" as const, requestId: "request-a", column: column(), version: 1 };
    const first = await repo.createVersion(owner, input);
    const replay = await repo.createVersion(owner, input);
    expect(replay.id).toBe(first.id);
    expect(await repo.list(owner)).toHaveLength(1);
    // reload: 새 adapter 인스턴스도 저장된 불변 스냅샷과 메타데이터를 복원한다.
    const reloaded = await new ColumnTemplateRepo(boards as unknown as ColumnTemplateBoardsRepo).list(owner);
    expect(reloaded[0]).toMatchObject({ templateKey: "template-a", version: 1, metadata: { required: false, wrapMode: "truncate" } });
    expect(await repo.list(ctx("org-cross-isolated", "user-cross"))).toHaveLength(0);
  });

  it("update와 이전 버전 원복은 과거를 덮지 않고 다음 버전을 만든다", async () => {
    const boards = new LocalBoardsRepo();
    const repo = new ColumnTemplateRepo(boards as unknown as ColumnTemplateBoardsRepo);
    const owner = ctx("org-update", "user-update");
    await repo.createVersion(owner, { templateKey: "template-version", name: "상태", scope: "org", requestId: "v1", column: column({ label: "상태" }), version: 1 });
    await repo.createVersion(owner, { templateKey: "template-version", name: "상태", scope: "org", requestId: "v2", column: column({ label: "진행 상태" }), version: 2 });
    const old = (await repo.list(owner)).find((record) => record.version === 1)!;
    await repo.createVersion(owner, { templateKey: old.templateKey, name: old.name, scope: old.scope, requestId: "rollback-v1", column: old.column, version: 3 });
    const versions = (await repo.list(owner)).filter((record) => record.templateKey === "template-version");
    expect(versions.map((record) => [record.version, record.column.label])).toEqual([[3, "상태"], [2, "진행 상태"], [1, "상태"]]);
  });

  it("비공개는 작성자만 보이고 회사 공개 발행은 member가 거부된다", async () => {
    const boards = new LocalBoardsRepo();
    const repo = new ColumnTemplateRepo(boards as unknown as ColumnTemplateBoardsRepo);
    await repo.createVersion(ctx("org-private", "user-private"), { templateKey: "private-a", name: "개인", scope: "private", requestId: "r1", column: column(), version: 1 });
    expect(await repo.list(ctx("org-private", "user-other", "member"))).toHaveLength(0);
    await expect(repo.createVersion(ctx("org-private", "user-other", "member"), { templateKey: "org-a", name: "공개", scope: "org", requestId: "r2", column: column(), version: 1 })).rejects.toThrow("ORG_PUBLISH_DENIED");
  });

  it("preview/apply 계약은 item_values를 포함하지 않고 타입 불일치도 값 변경 없이 막는다", () => {
    const template = {
      id: "preset-a", templateKey: "template-a", name: "상태", scope: "org" as const,
      ownerId: "user-a", version: 1, createdAt: "2026-08-21T00:00:00Z", column: column(),
      metadata: { description: null, required: false, validation: {}, editPolicy: {}, viewPolicy: {}, summaryHidden: false, wrapMode: "truncate" },
    };
    expect(previewColumnTemplate(template)).toEqual({ mode: "create", changes: ["새 컬럼으로 추가"], valueLossRisk: false });
    expect(previewColumnTemplate(template, column({ type: "text" }))).toMatchObject({ mode: "settings", typeMismatch: true, valueLossRisk: false });
    expect(JSON.stringify(template)).not.toContain("item_values");
  });
});
