import { notFound } from "next/navigation";
import { applyAs, getSession } from "@/lib/auth/session";
import { loadStageBoard } from "@/lib/crm/boardData";
import { getStageBoard } from "@/lib/crm/stageBoards";
import { StageBoardView } from "@/components/crm/StageBoardView";

/** 업무관리 보드 (T02 · B2) — 002 시드의 업무관리(kind=work) 단계. */
export default async function WorkBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ as?: string }>;
}) {
  const board = getStageBoard("work");
  if (!board) notFound();

  const sp = await searchParams;
  const ctx = applyAs(await getSession(), sp.as);
  const data = await loadStageBoard(ctx, board);

  return <StageBoardView data={data} />;
}
