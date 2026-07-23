import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { applyAs, getSession } from "@/lib/auth/session";
import { loadStageBoard } from "@/lib/crm/boardData";
import { getStageBoard } from "@/lib/crm/stageBoards";
import { getServerCrmSource } from "@/lib/repo/supabase/server-source";
import { NewLeadForm } from "@/components/crm/NewLeadForm";
import { StageBoardView } from "@/components/crm/StageBoardView";
import { createFirstLeadAction } from "./actions";

/** 신규고객 보드 (T02 · B2) — 002 시드의 신규고객(kind=marketing) 단계. */
export default async function NewCustomerPage({
  searchParams,
}: {
  searchParams: Promise<{
    as?: string;
    created?: string;
    error?: string;
  }>;
}) {
  const board = getStageBoard("newcust");
  if (!board) notFound();

  const sp = await searchParams;
  const ctx = applyAs(await getSession(), sp.as);
  const source = await getServerCrmSource();
  const data = await loadStageBoard(ctx, board, source);

  return (
    <div className="flex flex-col gap-6">
      <NewLeadForm
        action={createFirstLeadAction}
        requestId={randomUUID()}
        error={sp.error}
        created={sp.created === "1"}
      />
      <StageBoardView data={data} />
    </div>
  );
}
