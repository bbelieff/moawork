import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { BuilderWorkspaceSurface } from "@/components/workspace-builder/BuilderWorkspaceSurface";
import { loadOwnerWorkspaceOpsSnapshot } from "@/lib/dynamic-workspace/workspace-ops";

export default async function WorkspaceBuilderPage() {
  const ctx = await getSession();
  if (ctx.role !== "owner") redirect("/settings/members");
  return <BuilderWorkspaceSurface snapshot={await loadOwnerWorkspaceOpsSnapshot()} />;
}
