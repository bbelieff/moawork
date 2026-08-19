import { redirect } from "next/navigation";
import { applyAs, getSession } from "@/lib/auth/session";
import { repairContactBoardOnEntry } from "@/lib/contact/entry";
import { createClient } from "@/lib/supabase/server";

/**
 * 리드컨택 기본 탭의 제품 진입점(BBE-149).
 * active owner/admin의 정확한 워크스페이스 진입에서는 누락된 기본 구조를
 * additive repair한다(BBE-236 — newcust 와 같은 패턴).
 */
export default async function ContactBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ as?: string }>;
}) {
  const sp = await searchParams;
  const ctx = applyAs(await getSession(), sp.as);
  const result = await repairContactBoardOnEntry(ctx, await createClient());
  if (result.kind !== "ready") {
    const conflict = result.kind === "conflict";
    const permission = result.kind === "permission";
    return (
      <section className="rounded-xl border border-mw-line bg-mw-card p-5" aria-labelledby="contact-entry-title">
        <h1 id="contact-entry-title" className="text-lg font-semibold text-mw-fg">
          {conflict
            ? "리드컨택 보드를 하나로 확인하지 못했습니다"
            : permission
              ? "리드컨택 보드 복구 권한이 없습니다"
              : "리드컨택 보드를 찾을 수 없습니다"}
        </h1>
        <p className="mt-2 text-sm text-mw-sub">
          {conflict
            ? "회사 관리자에게 보드 구성을 확인해 달라고 요청해 주세요."
            : permission
              ? "활성 owner 또는 admin에게 이 워크스페이스의 기본 보드 복구를 요청해 주세요."
              : "회사 관리자에게 문의해 주세요 — 새 워크스페이스에는 이 보드가 자동으로 있어야 합니다."}
        </p>
      </section>
    );
  }
  const query = sp.as ? `?as=${encodeURIComponent(sp.as)}` : "";

  redirect(`/boards/${encodeURIComponent(result.boardId)}${query}`);
}
