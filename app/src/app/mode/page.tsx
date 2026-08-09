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

export default async function ModePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = sanitizeModeNext((await searchParams).next);
  const snapshot = await loadWorkspaceRoutingSnapshot();
  if (snapshot.kind === "unauthenticated") {
    redirect(`/login?next=${encodeURIComponent(modePath(next))}`);
  }
  if (snapshot.kind === "error") redirect("/workspace-entry?error=routing");

  const actor = await loadPlatformActor();
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
          <span className={styles.status}>로그인 완료</span>
        </header>

        <div className={styles.intro}>
          <p className={styles.eyebrow}>로그인 후 시작할 곳</p>
          <h1 id="mode-title">어디에서 시작할까요?</h1>
          <p>
            관리자 업무와 회사 업무는 서로 달라요.
            지금 할 일을 선택하면 권한이 확인된 화면으로 이동해요.
          </p>
        </div>

        <div className={styles.choices} role="group" aria-labelledby="mode-title">
          <form action="/mode/preference" method="post" className={styles.choiceForm}>
            <input type="hidden" name="mode" value="platform" />
            {next ? <input type="hidden" name="next" value={next} /> : null}
            <button
              type="submit"
              className={`${styles.choice} ${styles.platformChoice}`}
              aria-labelledby="platform-mode-title"
              aria-describedby="platform-mode-description"
            >
              <span className={styles.choiceIcon} aria-hidden="true">P</span>
              <span className={styles.choiceCopy}>
                <small>관리자 모드</small>
                <strong id="platform-mode-title">관리자 페이지 열기</strong>
                <span id="platform-mode-description">
                  릴리스 상태와 데모 회사를 확인해요.
                </span>
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
              aria-describedby="user-mode-description"
            >
              <span className={styles.choiceIcon} aria-hidden="true">W</span>
              <span className={styles.choiceCopy}>
                <small>사용자 모드</small>
                <strong id="user-mode-title">회사 업무로 가기</strong>
                <span id="user-mode-description">
                  회사 업무 흐름으로 돌아가며, 가입한 회사 수에 따라 바로 열거나 선택·연결해요.
                </span>
              </span>
              <b aria-hidden="true">→</b>
            </button>
          </form>
        </div>

        <p className={styles.safety}>
          이 선택은 시작 화면만 바꾸며 회사 접근 권한을 새로 만들지 않아요.
        </p>
      </section>
    </main>
  );
}
