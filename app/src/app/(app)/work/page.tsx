import { applyAs, getSession } from "@/lib/auth/session";
import { SupabaseBoardsRepo } from "@/lib/repo/supabase/boardsRepo";
import { resolveExistingContractWorkBoard } from "@/lib/work/entry";
import { createClient } from "@/lib/supabase/server";
import { canUseLocalSeedFallback } from "@/lib/supabase/local-fallback";
import { WorkManagementSource, WorkManagementUnavailableError } from "@/lib/repo/supabase/workManagementSource";
import { NotificationWorkBoard } from "@/components/work-management/NotificationWorkBoard";
import styles from "@/components/work-management/work-management.module.css";

/** Product entry for the installed contract-work default board (BBE-150). */
export default async function ContractWorkBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ as?: string; notification?: string }>;
}) {
  const sp = await searchParams;
  const ctx = applyAs(await getSession(), sp.as);
  // ★ BBE-202 — 이 화면은 로컬 시드로 «뜨지 않는다». WorkManagementSource 가 Supabase 전용이고
  //   로컬 대응물이 존재하지 않기 때문이다(로컬 소스 신설은 BBE-210 으로 분리했다).
  //   그래서 여기서는 500 만 없앤다 — 흰 오류 화면 대신 사유가 보이는 화면을 낸다.
  //   ★ BBE-150 의 경계(LocalBoardsRepo 금지 · createClient 1회)는 그대로 지킨다.
  //     로컬 repo 를 들이지 않고 «먼저 돌아설» 뿐이다.
  if (canUseLocalSeedFallback()) {
    return (
      <section className="rounded-xl border border-mw-line bg-mw-card p-5" role="status" aria-labelledby="work-unconfigured-title">
        <h1 id="work-unconfigured-title" className="text-lg font-semibold text-mw-fg">
          워크스페이스 데이터에 아직 연결되지 않았습니다
        </h1>
        <p className="mt-2 text-sm text-mw-sub">
          계약업체 실무 보드는 워크스페이스 데이터베이스에서 옵니다. 연결되면 여기에 바로 나옵니다.
        </p>
      </section>
    );
  }

  // The cookie-bound client is request scoped and shared by both the product
  // board lookup and the legacy BBE-29 fallback. Production must never cross
  // the environment-sensitive LocalBoardsRepo factory boundary here.
  const client = await createClient();
  const result = await resolveExistingContractWorkBoard(ctx, new SupabaseBoardsRepo(client));
  if (result.kind === "conflict") {
    return (
      <section className="rounded-xl border border-mw-line bg-mw-card p-5" aria-labelledby="work-entry-title">
        <h1 id="work-entry-title" className="text-lg font-semibold text-mw-fg">
          계약업체 실무 보드를 하나로 확인하지 못했습니다
        </h1>
        <p className="mt-2 text-sm text-mw-sub">
          회사 관리자에게 보드 구성을 확인해 달라고 요청해 주세요.
        </p>
      </section>
    );
  }
  // BBE-31 renders the product board through its table/calendar/gantt read
  // model. The generic /boards route remains available, but /work must not
  // bypass the work-management interaction contract after installation.
  let legacy:
    | { kind: "ready"; snapshot: Awaited<ReturnType<WorkManagementSource["load"]>> }
    | { kind: "blocked"; message: string };
  try {
    const snapshot = await new WorkManagementSource(client).load(ctx.org.id);
    legacy = { kind: "ready", snapshot };
  } catch (error) {
    const message = error instanceof WorkManagementUnavailableError
      ? error.message
      : "업무관리 화면을 불러오지 못했습니다.";
    legacy = { kind: "blocked", message };
  }
  if (legacy.kind === "ready") {
    return <NotificationWorkBoard snapshot={legacy.snapshot} highlightedItemId={sp.notification ?? null} />;
  }
  return (
    <section className={styles.blocked} role="status">
      <span aria-hidden>🔥</span><h1>업무관리</h1><p>{legacy.message}</p>
      <p className={styles.muted}>로컬 데이터로 대체하지 않았습니다. BBE-29 데이터 계약 활성화 후 다시 시도해 주세요.</p>
    </section>
  );
}
