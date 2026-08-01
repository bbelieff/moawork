import { createClient } from "@/lib/supabase/server";
import {
  isFeatureReleased,
  resolveAdminModeWorkspaceSelection,
  resolveInternalDemoOptions,
  resolveReleaseSelector,
  type ReleaseRing,
} from "@/lib/release-rings/resolve";

export type PlatformDemoWorkspace = Readonly<{
  /** Display-only context. Names, slugs, and ids never leave this loader. */
  releaseRing: ReleaseRing;
}>;

export type PlatformDemoTabState =
  | {
      kind: "ready";
      workspaces: readonly PlatformDemoWorkspace[];
      selectedIndex: number | null;
      tenantAccess: "active-membership" | "request-access";
    }
  | { kind: "unavailable" };

/** Discovery is rechecked per option after the canonical platform-page guard. */
export async function loadPlatformDemoTabState(): Promise<PlatformDemoTabState> {
  try {
    const supabase = await createClient();
    const selectionResult = await supabase.rpc(
      "get_my_admin_mode_workspace_selection",
    );
    if (selectionResult.error) return { kind: "unavailable" };
    const selection = resolveAdminModeWorkspaceSelection(selectionResult.data);
    if (selection.kind === "unavailable") return { kind: "unavailable" };
    const discoveredResult = await supabase.rpc(
      "list_reviewed_internal_demo_release_options",
    );
    if (discoveredResult.error) return { kind: "unavailable" };
    const discovered = resolveInternalDemoOptions(discoveredResult.data);
    if (discovered.kind !== "ready") return { kind: "unavailable" };

    const verified: Array<PlatformDemoWorkspace & { orgId: string; routePath: string }> = [];
    for (const option of discovered.options) {
      const selectorResult = await supabase.rpc(
        "resolve_workspace_release_selector",
        { p_org_id: option.orgId },
      );
      if (selectorResult.error) return { kind: "unavailable" };
      const selector = resolveReleaseSelector(
        Array.isArray(selectorResult.data)
          ? selectorResult.data[0]
          : selectorResult.data,
      );
      if (
        selector.kind !== "ready" ||
        selector.orgId !== option.orgId ||
        selector.routePath !== option.routePath ||
        (selector.routeAuthorization !== "reviewed_internal_demo" &&
          selector.routeAuthorization !== "active_membership") ||
        selector.releaseRing !== "canary" ||
        !selector.isInternal ||
        !isFeatureReleased(selector, "platform_reviewed_demo")
      ) return { kind: "unavailable" };
      verified.push({ orgId: selector.orgId, routePath: selector.routePath, releaseRing: selector.releaseRing });
    }
    if (selection.kind === "none") {
      return {
        kind: "ready",
        workspaces: Object.freeze(verified.map(({ releaseRing }) => Object.freeze({ releaseRing }))),
        selectedIndex: null,
        tenantAccess: "request-access",
      };
    }

    let selectedIndex = verified.findIndex((option) => (
      option.orgId === selection.orgId && option.routePath === selection.routePath
    ));
    if (selection.routeAuthorization === "reviewed_internal_demo" && selectedIndex < 0) {
      return { kind: "unavailable" };
    }
    if (selection.routeAuthorization === "active_membership" && selectedIndex < 0) {
      selectedIndex = verified.push({
        orgId: selection.orgId,
        routePath: selection.routePath,
        releaseRing: selection.releaseRing,
      }) - 1;
    }
    return {
      kind: "ready",
      workspaces: Object.freeze(verified.map(({ releaseRing }) => Object.freeze({ releaseRing }))),
      selectedIndex,
      tenantAccess: selection.routeAuthorization === "active_membership"
        ? "active-membership"
        : "request-access",
    };
  } catch {
    return { kind: "unavailable" };
  }
}
