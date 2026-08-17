import { redirect } from "next/navigation";
import { applyAs, getSession } from "@/lib/auth/session";
import { repairNewcustBoardOnEntry } from "@/lib/newcust/entry";
import { createClient } from "@/lib/supabase/server";

/**
 * 신규업체(신규리드)의 단일 제품 진입점(BBE-26 · BBE-145).
 *
 * 화면은 BBE-47 공용 보드 셸을 그대로 쓰고, 이 라우트는 신규리드 보드를 유일하게
 * 고른 뒤 canonical 보드 URL로만 보낸다. active owner/admin의 정확한 워크스페이스
 * 진입에서는 누락된 제품 기본 구조만 additive repair한다.
 *
 * D76 이후 새 워크스페이스는 생성 시 이 보드를 이미 갖고 있다(`ensureDefaultTabs`).
 * 그래서 「missing」은 이 변경 이전에 만들어진 기존 워크스페이스에서 복구 신호다.
 * 전역 백필은 하지 않고 현재 요청 조직만 복구한다. 문구가 «구조 팩 설치» 를 말하면 안 된다
 * (AGENTS.md — 「구조 팩」이라는 말 자체 금지, D76 이 그 개념을 폐기했다).
 */
export default async function NewCustomerPage({
  searchParams,
}: {
  searchParams: Promise<{ as?: string }>;
}) {
  const sp = await searchParams;
  const ctx = applyAs(await getSession(), sp.as);
  const result = await repairNewcustBoardOnEntry(ctx, await createClient());
  if (result.kind !== "ready") {
    const conflict = result.kind === "conflict";
    const permission = result.kind === "permission";
    return (
      <section className="rounded-xl border border-mw-line bg-mw-card p-5" aria-labelledby="newcust-entry-title">
        <h1 id="newcust-entry-title" className="text-lg font-semibold text-mw-fg">
          {conflict
            ? "신규리드 보드를 하나로 확인하지 못했습니다"
            : permission
              ? "신규리드 보드 복구 권한이 없습니다"
              : "신규리드 보드를 찾을 수 없습니다"}
        </h1>
        <p className="mt-2 text-sm text-mw-sub">
          {conflict
            ? "회사 관리자에게 중복된 기본 보드 구성을 확인해 달라고 요청해 주세요."
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
