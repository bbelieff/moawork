import { PlatformDemoWorkspaceShell, resolveDemoWorkspaceSelection } from "@/components/platform/PlatformDemoWorkspaceShell";
import { PlatformDemoWorkspaceTab } from "@/components/platform/PlatformDemoWorkspaceTab";
import { getStageBoard, STAGE_BOARDS } from "@/lib/crm/stageBoards";
import { resolvePlatformDemoCrm, toPlatformDemoStageBoard } from "@/lib/platform/demo-crm";
import { loadPlatformDemoTabState } from "@/lib/platform/demo";
import { requirePlatformAccess } from "@/lib/platform/guard";
import { createClient } from "@/lib/supabase/server";
import {
  importPlatformDemoCrmCsv,
  preparePlatformDemoWorkspace,
  selectPlatformDemoWorkspace,
} from "./actions";

export default async function PlatformDemoPage({ searchParams }: Readonly<{ searchParams: Promise<{ workspace?: string }> }>) {
  await requirePlatformAccess("/platform/demo");
  const [state, params] = await Promise.all([
    loadPlatformDemoTabState(),
    searchParams,
  ]);
  const exactSelectedDemo = state.kind === "ready"
    && state.selectedIndex !== null;
  const selection = resolveDemoWorkspaceSelection(params.workspace);
  const selectedBoard = getStageBoard(selection.boardSlug) ?? STAGE_BOARDS[0];
  const supabase = exactSelectedDemo ? await createClient() : null;
  const result = supabase ? await supabase.rpc("platform_get_selected_demo_crm", { p_board_kind: selectedBoard.kind }) : null;
  const payload = result && !result.error ? resolvePlatformDemoCrm(result.data) : null;
  const data = payload ? toPlatformDemoStageBoard(selectedBoard, payload) : null;
  const workspaceSurface = data
    ? { kind: "available" as const, content: <PlatformDemoWorkspaceShell activeScreen={selection.screen} data={data} importCsv={importPlatformDemoCrmCsv} /> }
    : exactSelectedDemo
      ? { kind: "access-required" as const }
      : undefined;
  return <PlatformDemoWorkspaceTab state={state} selectAction={selectPlatformDemoWorkspace} prepareAction={preparePlatformDemoWorkspace} workspaceSurface={workspaceSurface} deploymentVersion={process.env.MOAWORK_BUILD_SHA?.slice(0, 7) ?? null} />;
}
