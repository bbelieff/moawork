import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { Logo, Symbol } from "@/components/brand/Logo";
import { getRepo } from "@/lib/repo";
import { PRODUCT_NAME } from "@/lib/product";
import { AUTH_ERROR_MESSAGES, safeNextPath } from "@/lib/auth/oauth";
import { SESSION_COOKIE } from "@/lib/auth/session";
import styles from "./login.module.css";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const nextPath = safeNextPath(
    typeof params.next === "string" ? params.next : undefined,
  );
  const errorCode = typeof params.error === "string" ? params.error : "";
  const errorMessage = AUTH_ERROR_MESSAGES[errorCode];
  const devToolsEnabled = process.env.NODE_ENV !== "production";
  const users = devToolsEnabled ? getRepo().listUsers() : [];

  async function devLogin(formData: FormData) {
    "use server";
    if (process.env.NODE_ENV === "production") return;

    const uid = formData.get("uid");
    if (typeof uid !== "string") return;
    const jar = await cookies();
    jar.set(SESSION_COOKIE.uid, uid, { path: "/", httpOnly: true, sameSite: "lax" });
    jar.delete(SESSION_COOKIE.as);
    jar.delete(SESSION_COOKIE.org);
    redirect("/onboarding");
  }

  return (
    <main className={styles.page}>
      <article className={styles.story} aria-labelledby="brand-story-title">
        <div className={styles.storyGlow} aria-hidden="true" />
        <div className={styles.storyCopy}>
          <Logo height={34} className={styles.storyLogo} />
          <h1 id="brand-story-title">
            흐름은 단단하게,
            <br />
            <em>방식은 자유롭게.</em>
          </h1>
          <p>
            흩어진 고객, 계약, 정산과 협업을 하나의 흐름에 모으고
            <br className={styles.desktopBreak} /> 우리 팀의 방식대로 가볍게 연결하세요.
          </p>
        </div>

        <div className={styles.workspaceVisual} aria-hidden="true">
          <span className={`${styles.flowLine} ${styles.flowOne}`} />
          <span className={`${styles.flowLine} ${styles.flowTwo}`} />
          <span className={`${styles.flowLine} ${styles.flowThree}`} />
          <ModuleCard
            className={styles.moduleOne}
            toneClass={styles.toneBlue}
            title="고객 기록"
            label="Work Blue"
          />
          <ModuleCard
            className={styles.moduleTwo}
            toneClass={styles.toneTeal}
            title="업무 자동화"
            label="Flow Teal"
          />
          <ModuleCard
            className={styles.moduleThree}
            toneClass={styles.toneViolet}
            title="나의 워크스페이스"
            label="Moa Violet"
          />
          <ModuleCard
            className={styles.moduleFour}
            toneClass={styles.toneCoral}
            title="함께하는 사람"
            label="People Coral"
          />
        </div>
      </article>

      <aside className={styles.loginPanel} aria-label={`${PRODUCT_NAME} 로그인`}>
        <div className={styles.loginStack}>
          <div className={styles.miniCopy}>
            <span className={styles.symbolWrap}>
              <Symbol height={18} />
            </span>
            하나의 워크스페이스에서 시작하세요
          </div>

          <div className={styles.loginHeading}>
            <h2>{PRODUCT_NAME}에 로그인</h2>
            <p>
              Google 계정으로 안전하게 연결하고
              <br /> 우리 팀의 업무 흐름을 이어가세요.
            </p>
          </div>

          {errorMessage ? (
            <p role="alert" className={styles.alert}>
              {errorMessage}
            </p>
          ) : null}

          <GoogleSignInButton nextPath={nextPath} />

          <p className={styles.legal}>
            계속하면 MoaWork의 <span>이용약관</span> 및 <span>개인정보처리방침</span>에
            동의하게 됩니다.
          </p>
          <p className={styles.secure}>보호된 워크스페이스 연결</p>

          {devToolsEnabled ? (
            <section className={styles.devAccounts}>
              <div>
                <p className={styles.devTitle}>개발용 계정</p>
                <p className={styles.devHelp}>
                  로컬 UI와 역할별 범위를 확인할 때만 사용합니다.
                </p>
              </div>
              <form action={devLogin} className={styles.devForm}>
                {users.map((user) => (
                  <button
                    key={user.id}
                    type="submit"
                    name="uid"
                    value={user.id}
                    className={styles.devAccount}
                  >
                    <span>{user.name}</span>
                    <small>{user.email}</small>
                  </button>
                ))}
              </form>
            </section>
          ) : null}
        </div>
      </aside>
    </main>
  );
}

function ModuleCard({
  className,
  toneClass,
  title,
  label,
}: {
  className: string;
  toneClass: string;
  title: string;
  label: string;
}) {
  return (
    <div className={`${styles.moduleCard} ${className} ${toneClass}`}>
      <div className={styles.moduleHead}>
        <i />
        {title}
      </div>
      <div className={styles.moduleBar} />
      <div className={`${styles.moduleBar} ${styles.moduleBarShort}`} />
      <span className={styles.moduleChip}>{label}</span>
    </div>
  );
}
