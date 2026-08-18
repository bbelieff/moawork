import { redirect } from "next/navigation";
import { applyAs, getSession } from "@/lib/auth/session";
import { repairNewcustBoardOnEntry, resolveExistingNewcustBoard } from "@/lib/newcust/entry";
import { createClient } from "@/lib/supabase/server";
import { canUseLocalSeedFallback } from "@/lib/supabase/local-fallback";
import { getBoardsRepo } from "@/lib/repo/local/boardsRepo";

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
  // ★ BBE-171 — 개발 빌드 + Supabase 없음에서만 로컬 시드 보드로 «찾기만» 한다
  //   (BBE-203 #255 · BBE-202 #259 와 같은 규약. 이 라우트가 세 번째 적용이다).
  //
  //   조건을 «인라인» 으로 적어야 한다. 경계 검사기(check-production-repo-boundaries.mjs 의
  //   isInsideExplicitDevGuard)가 조건식을 «구문으로» 읽기 때문에, canUseLocalSeedFallback()
  //   안에 같은 NODE_ENV 검사가 있어도 함수 뒤에 숨으면 못 읽고 getBoardsRepo 를 운영 위반으로
  //   센다. 중복처럼 보이지만 지우면 게이트가 실패한다.
  //
  //   ★ 복구(repair)는 하지 않고 조회만 한다. repairNewcustBoardOnEntry 는 «이 변경 이전에
  //   만들어진 기존 워크스페이스» 를 위한 운영 경로다(리스·ensure 포함). 로컬 시드에는 이 보드가
  //   이미 있으므로 복구할 대상이 없고, 흉내 내면 운영 전용 절차를 두 벌로 만드는 셈이 된다.
  const result = process.env.NODE_ENV !== "production" && canUseLocalSeedFallback()
    ? await resolveExistingNewcustBoard(ctx, await getBoardsRepo())
    : await repairNewcustBoardOnEntry(ctx, await createClient());
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
