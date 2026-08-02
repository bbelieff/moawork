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
          <p className={styles.eyebrow}>시작 위치 선택</p>
          <h1 id="mode-title">어디에서 시작할까요?</h1>
          <p>
            플랫폼 운영과 내 워크스페이스는 서로 다른 영역이에요.
            필요한 공간을 선택하면 확인된 권한 범위로 이동합니다.
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
                <small>플랫폼 관리자</small>
                <strong id="platform-mode-title">플랫폼 운영으로 이동</strong>
                <span id="platform-mode-description">
                  릴리스와 데모 환경 등 운영 도구를 확인합니다.
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
                <small>일반 업무</small>
                <strong id="user-mode-title">내 워크스페이스로 이동</strong>
                <span id="user-mode-description">
                  소속된 회사의 업무와 기록을 이어서 확인합니다.
                </span>
              </span>
              <b aria-hidden="true">→</b>
            </button>
          </form>
        </div>

        <p className={styles.safety}>
          이 선택은 화면 모드만 바꾸며 멤버십이나 권한을 새로 만들지 않아요.
        </p>
      </section>
    </main>
  );
}
