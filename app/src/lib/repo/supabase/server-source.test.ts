import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CrmSource } from "./source";
import { getServerCrmSource } from "./server-source";
import { SupabaseCrmSource } from "./supabaseCrmSource";

describe("getServerCrmSource", () => {
  it("Supabase 환경에서는 매 요청의 SSR cookie client로 source를 새로 만든다", async () => {
    const firstClient = {} as SupabaseClient;
    const secondClient = {} as SupabaseClient;
    const createSupabaseClient = vi
      .fn<() => Promise<SupabaseClient>>()
      .mockResolvedValueOnce(firstClient)
      .mockResolvedValueOnce(secondClient);
    const dependencies = {
      isSupabaseConfigured: () => true,
      createSupabaseClient,
      getLocalSource: vi.fn(),
    };

    const first = await getServerCrmSource(dependencies);
    const second = await getServerCrmSource(dependencies);

    expect(first).toBeInstanceOf(SupabaseCrmSource);
    expect(second).toBeInstanceOf(SupabaseCrmSource);
    expect(second).not.toBe(first);
    expect(createSupabaseClient).toHaveBeenCalledTimes(2);
    expect(dependencies.getLocalSource).not.toHaveBeenCalled();
  });

  it("로컬 개발에서는 기존 cached source를 유지한다", async () => {
    const local = { kind: "local" } as CrmSource;
    const getLocalSource = vi.fn(() => local);
    const createSupabaseClient = vi.fn<() => Promise<SupabaseClient>>();
    const dependencies = {
      isSupabaseConfigured: () => false,
      createSupabaseClient,
      getLocalSource,
    };

    await expect(getServerCrmSource(dependencies)).resolves.toBe(local);
    await expect(getServerCrmSource(dependencies)).resolves.toBe(local);
    expect(getLocalSource).toHaveBeenCalledTimes(2);
    expect(createSupabaseClient).not.toHaveBeenCalled();
  });
});
