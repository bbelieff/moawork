import { redirect } from "next/navigation";
import { applyAs, getSession } from "@/lib/auth/session";
import { resolveExistingNewcustBoard } from "@/lib/newcust/entry";

/**
 * 신규업체의 단일 제품 진입점(BBE-26).
 *
 * 화면은 BBE-47 공용 보드 셸을 그대로 쓰고, 이 라우트는 기존 031 신규업체 보드를
 * 유일하게 고른 뒤 canonical 보드 URL로만 보낸다. GET 요청은 어떤 보드도 만들지 않는다.
 */
export default async function NewCustomerPage({
  searchParams,
}: {
  searchParams: Promise<{ as?: string }>;
}) {
  const sp = await searchParams;
  const ctx = applyAs(await getSession(), sp.as);
  const result = resolveExistingNewcustBoard(ctx);
  if (result.kind !== "ready") {
    const conflict = result.kind === "conflict";
    return (
      <section className="rounded-xl border border-mw-line bg-mw-card p-5" aria-labelledby="newcust-entry-title">
        <h1 id="newcust-entry-title" className="text-lg font-semibold text-mw-fg">
          {conflict ? "신규업체 보드를 하나로 확인하지 못했습니다" : "신규업체 보드가 아직 준비되지 않았습니다"}
        </h1>
        <p className="mt-2 text-sm text-mw-sub">
          {conflict
            ? "회사 관리자에게 보드 구성을 확인해 달라고 요청해 주세요."
            : "회사 관리자가 구조 팩 설치를 완료하면 여기서 바로 열 수 있습니다."}
        </p>
      </section>
    );
  }
  const query = sp.as ? `?as=${encodeURIComponent(sp.as)}` : "";

  redirect(`/boards/${encodeURIComponent(result.boardId)}${query}`);
}
