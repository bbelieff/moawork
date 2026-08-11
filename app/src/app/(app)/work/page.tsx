import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { WorkManagementSource, WorkManagementUnavailableError } from "@/lib/repo/supabase/workManagementSource";
import { NotificationWorkBoard } from "@/components/work-management/NotificationWorkBoard";
import styles from "@/components/work-management/work-management.module.css";

export default async function WorkBoardPage({ searchParams }: { searchParams: Promise<{ notification?: string }> }) {
  const ctx = await getSession();
  let result:
    | { kind: "ready"; snapshot: Awaited<ReturnType<WorkManagementSource["load"]>> }
    | { kind: "blocked"; message: string };
  try {
    const snapshot = await new WorkManagementSource(await createClient()).load(ctx.org.id);
    result = { kind: "ready", snapshot };
  } catch (error) {
    const message = error instanceof WorkManagementUnavailableError ? error.message : "업무관리 화면을 불러오지 못했습니다.";
    result = { kind: "blocked", message };
  }
  if (result.kind === "ready") return <NotificationWorkBoard snapshot={result.snapshot} highlightedItemId={(await searchParams).notification ?? null} />;
  return <section className={styles.blocked} role="status"><span aria-hidden>🔥</span><h1>업무관리</h1><p>{result.message}</p><p className={styles.muted}>로컬 데이터로 대체하지 않았습니다. BBE-29 데이터 계약 활성화 후 다시 시도해 주세요.</p></section>;
}
