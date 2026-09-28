import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Logo } from "@/components/brand/Logo";
import { loadWorkspaceRoutingSnapshot } from "@/lib/auth/workspace-entry-server";
import {
  decideModeDestination,
  sanitizeModeNext,
} from "@/lib/mode/contract";
import {
  modePreferenceCookie,
  readModePreference,
} from "@/lib/mode/preference";
import { loadPlatformActor } from "@/lib/platform/actor";
import styles from "./mode-page.module.css";

function modePath(next: string | null): string {
  return next ? `/mode?next=${encodeURIComponent(next)}` : "/mode";
}

const MODE_ERROR_MESSAGES: Record<string, string> = {
  // MOAWORK_MODE_PREFERENCE_SECRET 미설정/오설정 시 /mode/preference 가 여기로 돌려보낸다.
  // 서버 설정 문제이지 이 사람의 선택이 틀린 게 아니다 — login 의 error=config 와 같은 어법.
  config: "이 선택을 기억해 두는 기능이 잠시 꺼져 있어요. 관리자에게 알려 주시면 곧 정상화돼요.",
};

export default async function ModePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = sanitizeModeNext(params.next);
  const errorMessage = params.error ? MODE_ERROR_MESSAGES[params.error] : undefined;
  // The membership snapshot and the platform actor check are independent once
  // the request is authenticated, so they are issued together. Snapshot
  // redirects still win — the actor result is only consumed past them.
  const [snapshot, actor] = await Promise.all([
    loadWorkspaceRoutingSnapshot(),
    loadPlatformActor(),
  ]);
  if (snapshot.kind === "unauthenticated") {
    redirect(`/login?next=${encodeURIComponent(modePath(next))}`);
  }
  if (snapshot.kind === "error") redirect("/workspace-entry?error=routing");
  const preference = readModePreference(
    (await cookies()).get(modePreferenceCookie.name)?.value,
  );
  const platformAccess = actor.kind === "granted"
    ? "granted"
    : actor.kind === "unavailable"
      ? "unavailable"
      : "denied";
  const destination = decideModeDestination({
    preference,
    platformAccess,
    memberships: snapshot.memberships,
  });
  if (destination.kind !== "chooser") redirect(destination.path);

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="mode-title">
        <header className={styles.header}>
          <Logo height={34} href="/" />

        </header>

        <div className={styles.intro}>

          <h1 id="mode-title">시작 화면 선택</h1>
        </div>

        {errorMessage ? (
          <p role="status" className={styles.notice}>
            {errorMessage}
          </p>
        ) : null}

        <div className={styles.choices} role="group" aria-labelledby="mode-title">
          <form action="/mode/preference" method="post" className={styles.choiceForm}>
            <input type="hidden" name="mode" value="platform" />
            {next ? <input type="hidden" name="next" value={next} /> : null}
            <button
              type="submit"
              className={`${styles.choice} ${styles.platformChoice}`}
              aria-labelledby="platform-mode-title"
            >
              <span className={styles.choiceIcon} aria-hidden="true">P</span>
              <span className={styles.choiceCopy}>
                <small>관리자 모드</small>
                <strong id="platform-mode-title">관리자 페이지 열기</strong>
              </span>
              <b aria-hidden="true">→</b>
            </button>
          </form>

          <form action="/mode/preference" method="post" className={styles.choiceForm}>
            <input type="hidden" name="mode" value="user" />
            {next ? <input type="hidden" name="next" value={next} /> : null}
            <button
              type="submit"
              className={`${styles.choice} ${styles.userChoice}`}
              aria-labelledby="user-mode-title"
            >
              <span className={styles.choiceIcon} aria-hidden="true">W</span>
              <span className={styles.choiceCopy}>
                <small>사용자 모드</small>
                <strong id="user-mode-title">회사 업무로 가기</strong>
              </span>
              <b aria-hidden="true">→</b>
            </button>
          </form>
        </div>


      </section>
    </main>
  );
}
