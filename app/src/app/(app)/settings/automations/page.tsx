import { redirect } from "next/navigation";
import { AutomationPresetPanel } from "@/components/automation-presets/AutomationPresetPanel";
import { getSession } from "@/lib/auth/session";
import { loadOwnerWorkspaceOpsSnapshot } from "@/lib/dynamic-workspace/workspace-ops";
import { createClient } from "@/lib/supabase/server";

export default async function AutomationsPage() {
  const ctx = await getSession();
  if (ctx.role !== "owner") redirect("/settings/members");
  const [snapshot, templates] = await Promise.all([
    loadOwnerWorkspaceOpsSnapshot(),
    (await createClient()).from("message_templates").select("id", { count: "exact", head: true })
      .eq("org_id", ctx.org.id).in("status", ["approved", "승인"]),
  ]);
  return <AutomationPresetPanel snapshot={snapshot} approvedMessageTemplateCount={templates.count ?? 0} />;
}
