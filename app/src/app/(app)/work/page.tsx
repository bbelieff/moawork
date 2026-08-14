import { redirect } from "next/navigation";
import { applyAs, getSession } from "@/lib/auth/session";
import { getBoardsRepo } from "@/lib/repo/local/boardsRepo";
import { resolveExistingContractWorkBoard } from "@/lib/work/entry";

/** Product entry for the installed contract-work default board (BBE-150). */
export default async function ContractWorkBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ as?: string }>;
}) {
  const sp = await searchParams;
  const ctx = applyAs(await getSession(), sp.as);
  const result = await resolveExistingContractWorkBoard(ctx, await getBoardsRepo());
  if (result.kind !== "ready") {
    const conflict = result.kind === "conflict";
    return (
      <section className="rounded-xl border border-mw-line bg-mw-card p-5" aria-labelledby="work-entry-title">
        <h1 id="work-entry-title" className="text-lg font-semibold text-mw-fg">
          {conflict ? "계약업체 실무 보드를 하나로 확인하지 못했습니다" : "계약업체 실무 보드를 찾을 수 없습니다"}
        </h1>
        <p className="mt-2 text-sm text-mw-sub">
          {conflict
            ? "회사 관리자에게 보드 구성을 확인해 달라고 요청해 주세요."
            : "회사 관리자에게 문의해 주세요. 새 워크스페이스에는 이 보드가 자동으로 들어 있습니다."}
        </p>
      </section>
    );
  }
  const query = sp.as ? `?as=${encodeURIComponent(sp.as)}` : "";
  redirect(`/boards/${encodeURIComponent(result.boardId)}${query}`);
}
