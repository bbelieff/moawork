import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { decideSupporterAccess } from "./access";
import type { Ctx } from "@/lib/types";

function session(role: Ctx["role"] = "member"): Ctx {
  return {
    user: {
      id: "user-1",
      email: null,
      name: "테스터",
      avatar_url: null,
      created_at: "2026-09-01T00:00:00Z",
    },
    org: {
      id: "org-1",
      name: "테스트 회사",
      plan_tier: "free",
      created_at: "2026-09-01T00:00:00Z",
    },
    role,
    scope: "all",
  };
}

describe("decideSupporterAccess", () => {
  it("allows user mode with an active company session", () => {
    expect(
      decideSupporterAccess("user", {
        session: session(),
        actor: { kind: "denied", reason: "not_platform" },
        displayMode: "user",
      }),
    ).toEqual({ ok: true });
  });

  it("rejects user mode without a session", () => {
    expect(
      decideSupporterAccess("user", {
        session: null,
        actor: { kind: "denied", reason: "unauthenticated" },
        displayMode: null,
      }),
    ).toEqual({ ok: false, error: "unauthenticated" });
  });

  it("allows operations with grant plus platform display and no company session", () => {
    // 회사 멤버십이 없는 플랫폼 전담자가 막히면 안 된다.
    expect(
      decideSupporterAccess("operations", {
        session: null,
        actor: { kind: "granted" },
        displayMode: "platform",
      }),
    ).toEqual({ ok: true });
  });

  it("ignores the company session for operations either way", () => {
    for (const maybeSession of [session("owner"), session("member"), null] as const) {
      expect(
        decideSupporterAccess("operations", {
          session: maybeSession,
          actor: { kind: "granted" },
          displayMode: "platform",
        }),
      ).toEqual({ ok: true });
    }
  });

  it("maps an unauthenticated platform actor to 401, not 403", () => {
    expect(
      decideSupporterAccess("operations", {
        session: null,
        actor: { kind: "denied", reason: "unauthenticated" },
        displayMode: null,
      }),
    ).toEqual({ ok: false, error: "unauthenticated" });
  });

  it("rejects an owner-only company user from operations mode", () => {
    // 고객 회사 owner 권한은 운영 권한이 아니다.
    expect(
      decideSupporterAccess("operations", {
        session: session("owner"),
        actor: { kind: "denied", reason: "not_platform" },
        displayMode: "platform",
      }),
    ).toEqual({ ok: false, error: "operations_forbidden" });
  });

  it("rejects operations when the signed display mode disagrees", () => {
    // 서명된 표시 모드는 권한을 대신하지 못하고, 불일치도 허용하지 않는다.
    for (const displayMode of ["user", null] as const) {
      expect(
        decideSupporterAccess("operations", {
          session: null,
          actor: { kind: "granted" },
          displayMode,
        }),
      ).toEqual({ ok: false, error: "operations_forbidden" });
    }
  });

  it("fails closed when the platform guard is unavailable", () => {
    expect(
      decideSupporterAccess("operations", {
        session: null,
        actor: { kind: "unavailable" },
        displayMode: "platform",
      }),
    ).toEqual({ ok: false, error: "status_unavailable" });
  });
});
