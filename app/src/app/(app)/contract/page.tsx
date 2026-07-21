import { notFound } from "next/navigation";
import { applyAs, getSession } from "@/lib/auth/session";
import { loadStageBoard } from "@/lib/crm/boardData";
import { getStageBoard } from "@/lib/crm/stageBoards";
import { StageBoardView } from "@/components/crm/StageBoardView";

/**
 * 컨텍관리 보드 (T02 · B2) — 002 시드의 컨텍관리(kind=meeting) 단계.
 * 경로명은 배정 지시서를 따랐다(`stageBoards.ts` 의 명명 주의 참고).
 */
export default async function ContactBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ as?: string }>;
}) {
  const board = getStageBoard("contract");
  if (!board) notFound();

  const sp = await searchParams;
  const ctx = applyAs(await getSession(), sp.as);
  const data = await loadStageBoard(ctx, board);

  return <StageBoardView data={data} />;
}
