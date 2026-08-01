import { PlatformDemoWorkspaceTab } from "@/components/platform/PlatformDemoWorkspaceTab";
import { loadPlatformDemoTabContext } from "@/lib/platform/demo";
import { requirePlatformAccess } from "@/lib/platform/guard";
import { BuilderWorkspaceSurface } from "@/components/workspace-builder/BuilderWorkspaceSurface";
import { loadOwnerWorkspaceOpsSnapshotForOrg } from "@/lib/dynamic-workspace/workspace-ops";
import {
  createPlatformDemoCsvDryRun,
  preparePlatformDemoWorkspace,
  savePlatformDemoBuilder,
  selectPlatformDemoWorkspace,
} from "./actions";

export default async function PlatformDemoPage() {
  await requirePlatformAccess("/platform/demo");
  const { state, selectedOrgId: verifiedSelectedOrgId } = await loadPlatformDemoTabContext();
  const canLoadWorkspace = state.kind === "ready"
    && state.selectedIndex !== null
    && state.tenantAccess === "active-membership";
  const selectedOrgId = canLoadWorkspace ? verifiedSelectedOrgId : null;
  const snapshot = selectedOrgId
    ? await loadOwnerWorkspaceOpsSnapshotForOrg(selectedOrgId)
    : null;
  const workspaceSurface = snapshot?.readError
    ? { kind: "access-required" as const }
    : snapshot && snapshot.boards.length > 0
      ? {
          kind: "available" as const,
          content: (
            <BuilderWorkspaceSurface
              snapshot={snapshot}
              saveBuilderAction={savePlatformDemoBuilder}
              createCsvDryRunAction={createPlatformDemoCsvDryRun}
            />
          ),
        }
      : selectedOrgId
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
