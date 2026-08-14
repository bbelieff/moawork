import { redirect } from "next/navigation";
import { applyAs, getSession } from "@/lib/auth/session";
import { BoardsService } from "@/lib/boards/service";
import { resolveExistingContactBoard } from "@/lib/contact/entry";

/**
 * 리드컨택 기본 탭의 제품 진입점(BBE-149).
 * GET은 source로 기존 보드를 고르고 canonical 보드 화면으로 이동할 뿐 생성하지 않는다.
 */
export default async function ContactBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ as?: string }>;
}) {
  const sp = await searchParams;
  const ctx = applyAs(await getSession(), sp.as);
  const result = await resolveExistingContactBoard(ctx, new BoardsService());
  if (result.kind !== "ready") {
    const conflict = result.kind === "conflict";
    return (
      <section className="rounded-xl border border-mw-line bg-mw-card p-5" aria-labelledby="contact-entry-title">
        <h1 id="contact-entry-title" className="text-lg font-semibold text-mw-fg">
          {conflict ? "리드컨택 보드를 하나로 확인하지 못했습니다" : "리드컨택 보드를 찾을 수 없습니다"}
        </h1>
        <p className="mt-2 text-sm text-mw-sub">
          {conflict
            ? "회사 관리자에게 보드 구성을 확인해 달라고 요청해 주세요."
            : "회사 관리자에게 문의해 주세요 — 새 워크스페이스에는 이 보드가 자동으로 있어야 합니다."}
        </p>
      </section>
    );
  }
  const query = sp.as ? `?as=${encodeURIComponent(sp.as)}` : "";

  redirect(`/boards/${encodeURIComponent(result.boardId)}${query}`);
}
