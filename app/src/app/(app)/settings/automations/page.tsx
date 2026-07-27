import { redirect } from "next/navigation";
import { AutomationPresetPanel } from "@/components/automation-presets/AutomationPresetPanel";
import { getSession } from "@/lib/auth/session";
import { loadFunctionalMvpAvailability } from "@/lib/dynamic-workspace/server-contract";

export default async function AutomationsPage() {
  const ctx = await getSession();
  if (ctx.role !== "owner") redirect("/settings/members");
  return <AutomationPresetPanel availability={await loadFunctionalMvpAvailability({ orgId: ctx.org.id, workspaceId: ctx.org.id, userId: ctx.user.id, isOwner: true })} />;
}
