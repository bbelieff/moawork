import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteField: vi.fn(),
  permission: vi.fn(),
  requireCtx: vi.fn(),
}));

vi.mock("@/lib/custom", () => {
  class ForbiddenError extends Error {}
  class ServiceUnavailableError extends Error {}
  return {
    CUSTOM_FIELD_DELETE_CONFIRM: "delete",
    ForbiddenError,
    ServiceUnavailableError,
    requireCtx: mocks.requireCtx,
    createRequestCustomService: async () => ({
      renameField: vi.fn(),
      deleteField: mocks.deleteField,
    }),
    parseUpdateFieldDef: vi.fn(),
    jsonOk: (data: unknown, status = 200) => Response.json({ data }, { status }),
    readJson: vi.fn(),
    toErrorResponse: (error: unknown) => {
      if (error instanceof ForbiddenError) return Response.json({}, { status: 403 });
      if (error instanceof ServiceUnavailableError) return Response.json({}, { status: 503 });
      return Response.json({}, { status: 500 });
    },
  };
});

vi.mock("@/lib/perm/guard", () => ({ loadPermGuard: mocks.permission }));

import { DELETE } from "./route";
import { CUSTOM_FIELD_DELETE_CONFIRM } from "@/lib/custom";

const routeCtx = { params: Promise.resolve({ fieldId: "field-a" }) };
function request(confirm?: string) {
  const headers = new Headers();
  if (confirm !== undefined) headers.set("x-moawork-confirm", confirm);
  return new Request("http://localhost/api/fields/field-a", { method: "DELETE", headers });
}

describe("BBE-191 custom field deletion guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCtx.mockResolvedValue({
      user: { id: "user-a" },
      org: { id: "org-a" },
      role: "owner",
      scope: "all",
    });
    mocks.permission.mockResolvedValue({ kind: "allowed" });
    mocks.deleteField.mockResolvedValue(true);
  });

  it("rejects a request without the confirmation token before any mutation", async () => {
    const response = await DELETE(request(), routeCtx);
    expect(response.status).toBe(400);
    expect(mocks.requireCtx).not.toHaveBeenCalled();
    expect(mocks.deleteField).not.toHaveBeenCalled();
  });

  it("rejects an invalid confirmation token before any mutation", async () => {
    const response = await DELETE(request("no"), routeCtx);
    expect(response.status).toBe(400);
    expect(mocks.deleteField).not.toHaveBeenCalled();
  });

  it("uses the authenticated organization and requires structure permission", async () => {
    const response = await DELETE(request(CUSTOM_FIELD_DELETE_CONFIRM), routeCtx);
    expect(response.status).toBe(200);
    expect(mocks.permission).toHaveBeenCalledWith("org-a", "structure.column_manage");
    expect(mocks.deleteField).toHaveBeenCalledWith("org-a", "field-a");
  });

  it("does not mutate when the authenticated member lacks permission", async () => {
    mocks.permission.mockResolvedValue({ kind: "denied", reason: "permission" });
    const response = await DELETE(request(CUSTOM_FIELD_DELETE_CONFIRM), routeCtx);
    expect(response.status).toBe(403);
    expect(mocks.deleteField).not.toHaveBeenCalled();
  });

  it("keeps permission infrastructure failure distinct and does not mutate", async () => {
    mocks.permission.mockResolvedValue({ kind: "denied", reason: "unavailable" });
    const response = await DELETE(request(CUSTOM_FIELD_DELETE_CONFIRM), routeCtx);
    expect(response.status).toBe(503);
    expect(mocks.deleteField).not.toHaveBeenCalled();
  });
});
