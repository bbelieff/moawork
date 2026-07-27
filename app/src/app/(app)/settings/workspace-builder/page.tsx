import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { BuilderWorkspaceSurface } from "@/components/workspace-builder/BuilderWorkspaceSurface";
import { functionalMvpCsvScope, loadFunctionalMvpAvailability } from "@/lib/dynamic-workspace/server-contract";

export default async function WorkspaceBuilderPage() {
  const ctx = await getSession();
  if (ctx.role !== "owner") redirect("/settings/members");
  const scope = { orgId: ctx.org.id, workspaceId: ctx.org.id, userId: ctx.user.id, isOwner: true };
  return <BuilderWorkspaceSurface availability={await loadFunctionalMvpAvailability(scope)} csvScope={functionalMvpCsvScope(scope)} />;
}
