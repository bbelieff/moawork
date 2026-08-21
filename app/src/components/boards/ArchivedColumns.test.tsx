import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ listArchivedColumns: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn(async () => ({ org: { id: "org-a" } })) }));
vi.mock("@/lib/boards/server", () => ({ createRequestBoards: vi.fn(async () => ({ service: { listArchivedColumns: mocks.listArchivedColumns } })) }));
vi.mock("@/app/(app)/boards/column-restore-actions", () => ({ restoreColumnAction: vi.fn() }));

import { ArchivedColumns } from "./ArchivedColumns";

function text(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  const element = node as { props?: { children?: unknown } };
  return text(element.props?.children);
}

describe("BBE-221 보관 컬럼 UI", () => {
  it("원본 복구와 동명이름 새 세대의 의미를 명시한다", async () => {
    mocks.listArchivedColumns.mockResolvedValueOnce([{ id: "c1", label: "메모" }]);
    const rendered = await ArchivedColumns({ boardId: "board-a" });
    expect(text(rendered)).toContain("원본을 복구하면 이전 값이 다시 보입니다");
    expect(text(rendered)).toContain("같은 이름으로 새 컬럼을 만들면 빈 컬럼으로 시작합니다");
    expect(text(rendered)).toContain("원본 복구");
    expect(JSON.stringify(rendered)).not.toContain('name":"boardId');
  });

  it("보관 컬럼이 없으면 복구 영역을 표시하지 않는다", async () => {
    mocks.listArchivedColumns.mockResolvedValueOnce([]);
    await expect(ArchivedColumns({ boardId: "board-a" })).resolves.toBeNull();
  });
});
