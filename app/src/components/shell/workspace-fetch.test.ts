import { afterEach, describe, expect, it, vi } from "vitest";
import { currentWorkspaceSlug, workspaceFetch } from "./workspace-fetch";

afterEach(() => vi.unstubAllGlobals());

describe("workspaceFetch (QA #887)", () => {
  it("회사 주소에서는 그 회사를 머리글로 보내고, 아니면 보내지 않는다", async () => {
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    await workspaceFetch("/api/notifications", { cache: "no-store" }, "/w/acme/boards/1");
    await workspaceFetch("/api/notifications", {}, "/workspaces");
    const sent = fetchMock.mock.calls.map((call) => new Headers((call as unknown as [string, RequestInit])[1]?.headers).get("x-mw-workspace"));
    expect(sent).toEqual(["acme", null]);
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].cache).toBe("no-store");
  });

  it("이름표 모양이 아닌 주소는 회사로 읽지 않는다", () => {
    expect(currentWorkspaceSlug("/w/acme")).toBe("acme");
    expect(currentWorkspaceSlug("/w/Acme/x")).toBeNull();
    expect(currentWorkspaceSlug("/boards/1")).toBeNull();
  });
});
