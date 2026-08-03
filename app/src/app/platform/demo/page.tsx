import { PlatformDemoCrm } from "@/components/platform/PlatformDemoCrm";
import { PlatformDemoWorkspaceTab } from "@/components/platform/PlatformDemoWorkspaceTab";
import { getSessionOrNull } from "@/lib/auth/session";
import { loadStageBoard } from "@/lib/crm/boardData";
import { getStageBoard, STAGE_BOARDS } from "@/lib/crm/stageBoards";
import { loadOwnerWorkspaceOpsSnapshotForOrg } from "@/lib/dynamic-workspace/workspace-ops";
import { loadPlatformDemoTabContext } from "@/lib/platform/demo";
import { requirePlatformAccess } from "@/lib/platform/guard";
import {
  importPlatformDemoCrmCsv,
  preparePlatformDemoWorkspace,
  selectPlatformDemoWorkspace,
} from "./actions";

export default async function PlatformDemoPage({ searchParams }: Readonly<{ searchParams: Promise<{ crm?: string }> }>) {
  await requirePlatformAccess("/platform/demo");
  const [{ state, selectedOrgId }, ctx, params] = await Promise.all([
    loadPlatformDemoTabContext(),
    getSessionOrNull(),
    searchParams,
  ]);
  const exactSelectedDemo = state.kind === "ready"
    && state.selectedIndex !== null
    && state.tenantAccess === "active-membership"
    && state.selectedWorkspaceIsCurrent
    && selectedOrgId !== null
    && ctx?.org.id === selectedOrgId;
  const snapshot = exactSelectedDemo ? await loadOwnerWorkspaceOpsSnapshotForOrg(selectedOrgId) : null;
  const selectedBoard = getStageBoard(params.crm ?? "") ?? STAGE_BOARDS[0];
  const data = exactSelectedDemo && snapshot && !snapshot.readError && snapshot.boards.length > 0 && ctx
    ? await loadStageBoard(ctx, selectedBoard)
    : null;
  const workspaceSurface = snapshot?.readError
    ? { kind: "access-required" as const }
    : snapshot && data
      ? { kind: "available" as const, content: <PlatformDemoCrm data={data} importCsv={importPlatformDemoCrmCsv} /> }
      : exactSelectedDemo
        ? { kind: "needs-setup" as const }
        : undefined;
  return <PlatformDemoWorkspaceTab state={state} selectAction={selectPlatformDemoWorkspace} prepareAction={preparePlatformDemoWorkspace} workspaceSurface={workspaceSurface} deploymentVersion={process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null} />;
}
