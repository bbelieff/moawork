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
          <Logo height={42} className={styles.storyLogo} />
          <h1 id="brand-story-title">
            흐름은 단단하게,
            <br />
            방식은 <em>자유롭게.</em>
          </h1>
          <p>
            고객·계약·정산은 한 흐름으로.
            <br className={styles.desktopBreak} /> 팀은 각자의 방식대로.
          </p>
        </div>

        <div className={styles.workspaceVisual} aria-hidden="true">
          <span className={`${styles.flowLine} ${styles.flowOne}`} />
          <span className={`${styles.flowLine} ${styles.flowTwo}`} />
          <span className={`${styles.flowLine} ${styles.flowThree}`} />
          <span className={`${styles.flowLine} ${styles.flowFour}`} />
          <div className={styles.workspaceCore}>
            <span className={styles.coreSymbol}>
              <Symbol height={24} />
            </span>
            <span>
              <strong>하나의 워크스페이스</strong>
              <small>모든 업무 흐름의 중심</small>
            </span>
          </div>
          <ModuleCard
            className={styles.moduleOne}
            toneClass={styles.toneBlue}
            title="고객·계약"
            label="기록됨"
          />
          <ModuleCard
            className={styles.moduleTwo}
            toneClass={styles.toneTeal}
            title="업무 흐름"
            label="자동 정리"
          />
          <ModuleCard
            className={styles.moduleThree}
            toneClass={styles.toneViolet}
            title="워크스페이스"
            label="한곳에 모임"
          />
          <ModuleCard
            className={styles.moduleFour}
            toneClass={styles.toneCoral}
            title="팀 협업"
            label="함께 진행"
          />
        </div>
      </article>

      <section className={styles.loginPanel} aria-labelledby="login-title">
        <div className={styles.loginStack}>
          <div className={styles.miniCopy}>
            <span className={styles.symbolWrap}>
              <Symbol height={26} />
            </span>
            하나로 모으고, 자유롭게 일하세요
          </div>

          <div className={styles.loginHeading}>
            <h2 id="login-title">{PRODUCT_NAME}에 로그인</h2>
            <p>
              Google 계정으로 팀의 업무 흐름에
              <br /> 안전하게 연결하세요.
            </p>
          </div>

          {errorMessage ? (
            <p role="alert" className={styles.alert}>
              {errorMessage}
            </p>
          ) : null}

          <GoogleSignInButton nextPath={nextPath} />

          <p className={styles.legal}>
            계속하면 MoaWork 이용약관 및 개인정보처리방침에 동의하게 됩니다.
          </p>
          <p className={styles.secure}>Google OAuth로 안전하게 연결</p>

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
      </section>
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
