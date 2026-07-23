import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({
  hasSupabaseEnv: vi.fn(),
  createClient: vi.fn(),
  isFeatureEnabled: vi.fn(),
}));

vi.mock("@/lib/supabase/env", () => ({
  hasSupabaseEnv: mocks.hasSupabaseEnv,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));
vi.mock("@/lib/repo", () => ({
  getRepo: () => ({ isFeatureEnabled: mocks.isFeatureEnabled }),
}));

import {
  EntitlementReadError,
  getFeatureStatesForOrg,
  getLockedFeaturesForOrg,
  readSupabaseFeatureStates,
} from "./entitlements";

function asClient(value: unknown): SupabaseClient {
  return value as SupabaseClient;
}

function queryClient(result: unknown): SupabaseClient {
  const inQuery = vi.fn().mockResolvedValue(result);
  const eq = vi.fn(() => ({ in: inQuery }));
  const select = vi.fn(() => ({ eq }));
  return asClient({ from: vi.fn(() => ({ select })) });
}

describe("entitlements", () => {
  beforeEach(() => {
    mocks.hasSupabaseEnv.mockReset();
    mocks.createClient.mockReset();
    mocks.isFeatureEnabled.mockReset();
  });

  it("Supabase에서는 org_entitlements의 enabled 상태를 실제로 읽는다", async () => {
    const client = queryClient({
      data: [
        { feature_key: "core.crm", enabled: true },
        { feature_key: "core.dash", enabled: false },
      ],
      error: null,
    });

    await expect(
      readSupabaseFeatureStates(client, "org-1", [
        "core.crm",
        "core.dash",
        "core.files",
      ]),
    ).resolves.toEqual(
      new Map([
        ["core.crm", true],
        ["core.dash", false],
        ["core.files", false],
      ]),
    );
  });

  it("Supabase 조회 오류를 기능 OFF로 가장하지 않는다", async () => {
    const client = queryClient({
      data: null,
      error: { message: "denied", code: "42501" },
    });
    await expect(
      readSupabaseFeatureStates(client, "org-1", ["core.crm"]),
    ).rejects.toMatchObject({
      name: "EntitlementReadError",
      code: "42501",
    } satisfies Partial<EntitlementReadError>);
  });

  it("Supabase 환경에서는 서버 클라이언트를 사용한다", async () => {
    mocks.hasSupabaseEnv.mockReturnValue(true);
    mocks.createClient.mockResolvedValue(
      queryClient({
        data: [{ feature_key: "core.crm", enabled: true }],
        error: null,
      }),
    );

    await expect(
      getFeatureStatesForOrg("org-1", ["core.crm"]),
    ).resolves.toEqual(new Map([["core.crm", true]]));
    expect(mocks.isFeatureEnabled).not.toHaveBeenCalled();
  });

  it("Local 개발 모드는 기존 Repo fallback을 유지한다", async () => {
    mocks.hasSupabaseEnv.mockReturnValue(false);
    mocks.isFeatureEnabled.mockImplementation(
      (_orgId: string, feature: string) => feature === "core.crm",
    );

    await expect(
      getLockedFeaturesForOrg("local-org", ["core.crm", "mod.notify"]),
    ).resolves.toEqual(["mod.notify"]);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
