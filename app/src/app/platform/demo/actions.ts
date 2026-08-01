"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePlatformAccess } from "@/lib/platform/guard";
import { resolveInternalDemoOptions } from "@/lib/release-rings/resolve";
import { createClient } from "@/lib/supabase/server";

function unavailable(): never {
  redirect("/platform/demo?error=unavailable");
}

/**
 * Selects an option by its server-verified list position. No workspace id or
 * slug is accepted from the browser, and the RPC rechecks current authority.
 */
export async function selectPlatformDemoWorkspace(formData: FormData) {
  await requirePlatformAccess("/platform/demo");

  const rawIndex = formData.get("demoIndex");
  const index = typeof rawIndex === "string" ? Number(rawIndex) : Number.NaN;
  if (!Number.isInteger(index) || index < 0) unavailable();

  const supabase = await createClient();
  const discoveredResult = await supabase.rpc(
    "list_reviewed_internal_demo_release_options",
  );
  if (discoveredResult.error) unavailable();

  const discovered = resolveInternalDemoOptions(discoveredResult.data);
  if (discovered.kind !== "ready" || index >= discovered.options.length) {
    unavailable();
  }

  const option = discovered.options[index];
  const selectionResult = await supabase.rpc(
    "platform_set_admin_mode_workspace_selection",
    {
      p_request_id: crypto.randomUUID(),
      p_org_id: option.orgId,
    },
  );
  if (selectionResult.error) unavailable();

  revalidatePath("/platform/demo");
  redirect("/platform/demo");
}
