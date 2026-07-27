import { redirect } from "next/navigation";
import { AutomationPresetPanel } from "@/components/automation-presets/AutomationPresetPanel";
import { getSession } from "@/lib/auth/session";

export default async function AutomationsPage() {
  const ctx = await getSession();
  if (ctx.role !== "owner") redirect("/settings/members");
  return <AutomationPresetPanel />;
}
