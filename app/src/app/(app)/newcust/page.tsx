import { redirect } from "next/navigation";
import { applyAs, getSession } from "@/lib/auth/session";
import { repairNewcustBoardOnEntry } from "@/lib/newcust/entry";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";

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
/**
 * 워크스페이스 DB 미연결 — 오류가 아니라 «아직 연결 안 됨» 이다.
 * 「보드를 찾을 수 없다」로 위장하지 않는다: 못 찾은 것과 아직 못 물어본 것은 다른 사실이고,
 * 회사 관리자에게 문의하라고 잘못 안내하게 된다.
 */
function NewcustNotConnected() {
  return (
    <section
      className="rounded-xl border border-mw-line bg-mw-card p-5"
      aria-labelledby="newcust-entry-title"
      role="status"
      data-testid="newcust-not-connected"
    >
      <h1 id="newcust-entry-title" className="text-lg font-semibold text-mw-fg">
        워크스페이스 데이터에 아직 연결되지 않았습니다
      </h1>
      <p className="mt-2 text-sm text-mw-sub">
        신규리드 보드는 워크스페이스 데이터베이스에서 옵니다. 연결되면 여기에서 바로 접수를 시작할 수 있어요.
      </p>
    </section>
  );
}

export default async function NewCustomerPage({
  searchParams,
}: {
  searchParams: Promise<{ as?: string }>;
}) {
  const sp = await searchParams;
  const ctx = applyAs(await getSession(), sp.as);
  // ★ 환경변수가 없으면(로컬 시드 모드) `createClient()` 가 곧바로 throw 해서 이 화면이
  // 500 이었다(lib/supabase/env.ts). 먼저 갈라 «아직 연결 안 됨» 을 보여준다.
  // 로컬 어댑터로 우회하지 않는다 — 페이지가 로컬 repo 를 부르는 것은 프로덕션 경계
  // 정책이 막는 일이다(scripts/check-production-repo-boundaries.mjs). BBE-190 과 같은 패턴.
  if (!hasSupabaseEnv()) return <NewcustNotConnected />;

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
