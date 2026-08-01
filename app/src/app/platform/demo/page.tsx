import { PlatformDemoWorkspaceTab } from "@/components/platform/PlatformDemoWorkspaceTab";
import { loadPlatformDemoTabState } from "@/lib/platform/demo";
import { requirePlatformAccess } from "@/lib/platform/guard";
import { BuilderWorkspaceSurface } from "@/components/workspace-builder/BuilderWorkspaceSurface";
import { loadOwnerWorkspaceOpsSnapshot } from "@/lib/dynamic-workspace/workspace-ops";
import { preparePlatformDemoWorkspace, selectPlatformDemoWorkspace } from "./actions";

export default async function PlatformDemoPage() {
  await requirePlatformAccess("/platform/demo");
  const state = await loadPlatformDemoTabState();
  const canLoadWorkspace = state.kind === "ready"
    && state.selectedIndex !== null
    && state.tenantAccess === "active-membership"
    && state.selectedWorkspaceIsCurrent;
  const snapshot = canLoadWorkspace
    ? await loadOwnerWorkspaceOpsSnapshot()
    : null;
  const workspaceSurface = snapshot?.readError
    ? { kind: "access-required" as const }
    : snapshot && snapshot.boards.length > 0
      ? { kind: "available" as const, content: <BuilderWorkspaceSurface snapshot={snapshot} /> }
      : canLoadWorkspace
        ? { kind: "needs-setup" as const }
        : undefined;
  return (
    <PlatformDemoWorkspaceTab
      state={state}
      selectAction={selectPlatformDemoWorkspace}
      prepareAction={preparePlatformDemoWorkspace}
      workspaceSurface={workspaceSurface}
      deploymentVersion={process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null}
    />
  );
}
