import { createClient } from "@/lib/supabase/server";

export type PlatformActor =
  | { kind: "granted" }
  | { kind: "denied"; reason: "unauthenticated" | "not_platform" }
  | { kind: "unavailable" };

export type PlatformActorClient = {
  auth: {
    getUser: () => Promise<{ data: { user: unknown | null }; error: unknown | null }>;
  };
  rpc: (name: "is_platform_admin") => Promise<{ data: unknown; error: unknown | null }>;
};

type PlatformActorFailure =
  | "auth_error"
  | "grant_error"
  | "grant_malformed"
  | "unexpected_error";

function logPlatformActorFailure(reason: PlatformActorFailure): void {
  // Classification only: never log an email, user/org ID, cookie, RPC payload,
  // or provider error object from this security boundary.
  console.warn("[platform-actor] unavailable", { reason });
}

export function resolvePlatformActor(
  userResult: { data: { user: unknown | null }; error: unknown | null },
  grantResult?: { data: unknown; error: unknown | null },
): PlatformActor {
  if (userResult.error) return { kind: "unavailable" };
  if (!userResult.data.user) return { kind: "denied", reason: "unauthenticated" };
  if (!grantResult || grantResult.error || typeof grantResult.data !== "boolean") {
    return { kind: "unavailable" };
  }
  return grantResult.data ? { kind: "granted" } : { kind: "denied", reason: "not_platform" };
}

/**
 * Platform-plane actor check. It intentionally does not load workspace
 * membership, selected-org cookies, workspace-entry requests, or user email.
 * The no-argument SECURITY DEFINER RPC binds the decision to auth.uid().
 */
export async function loadPlatformActor(
  client?: PlatformActorClient,
): Promise<PlatformActor> {
  try {
    const supabase = client ?? await createClient();
    const userResult = await supabase.auth.getUser();
    if (userResult.error) {
      logPlatformActorFailure("auth_error");
      return resolvePlatformActor(userResult);
    }
    if (!userResult.data.user) {
      return resolvePlatformActor(userResult);
    }
    const grantResult = await supabase.rpc("is_platform_admin");
    if (grantResult.error) {
      logPlatformActorFailure("grant_error");
    } else if (typeof grantResult.data !== "boolean") {
      logPlatformActorFailure("grant_malformed");
    }
    return resolvePlatformActor(userResult, grantResult);
  } catch {
    logPlatformActorFailure("unexpected_error");
    return { kind: "unavailable" };
  }
}
