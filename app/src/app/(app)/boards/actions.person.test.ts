import { beforeEach, describe, expect, it, vi } from "vitest";

const setCells = vi.fn(async () => ({ errors: [] }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: vi.fn() }) }));
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => ({
    org: { id: "org-1", name: "회사" },
    user: { id: "owner-1", name: "대표", email: "owner@example.test" },
    role: "owner",
    scope: "all",
  }),
}));
vi.mock("@/lib/perm/guard", () => ({ loadPermGuard: async () => ({ kind: "allowed" }) }));
vi.mock("@/lib/perm/server", () => ({ recordRiskyAction: async () => ({ ok: true }) }));
vi.mock("@/lib/boards/server", () => ({ createRequestBoards: async () => ({ service: { setCells } }) }));

import { setCellAction } from "./actions";

function personForm(value: string): FormData {
  const form = new FormData();
  form.set("boardId", "board-1");
  form.set("itemId", "item-1");
  form.set("columnKey", "owner");
  form.set("kind", "person");
  form.set("value", value);
  return form;
}

describe("setCellAction person selection", () => {
  beforeEach(() => setCells.mockClear());

  it("선택한 조직 멤버 ID를 보드 서비스에 저장한다", async () => {
    await setCellAction(personForm("member-account-b"));
    expect(setCells).toHaveBeenCalledWith(
      expect.objectContaining({ org: { id: "org-1", name: "회사" } }),
      "board-1",
      "item-1",
      { owner: "member-account-b" },
    );
  });

  it("미배정 선택을 null로 저장한다", async () => {
    await setCellAction(personForm(""));
    expect(setCells).toHaveBeenCalledWith(expect.anything(), "board-1", "item-1", { owner: null });
  });
});

describe("setCellAction status selection", () => {
  beforeEach(() => setCells.mockClear());

  it("passes the exact selected option id to the request-scoped board service", async () => {
    const form = new FormData();
    form.set("boardId", "board-1");
    form.set("itemId", "item-1");
    form.set("columnKey", "status");
    form.set("value", "opt-doing");

    await setCellAction(form);

    expect(setCells).toHaveBeenCalledWith(
      expect.objectContaining({ org: expect.objectContaining({ id: "org-1" }) }),
      "board-1",
      "item-1",
      { status: "opt-doing" },
    );
  });
});
