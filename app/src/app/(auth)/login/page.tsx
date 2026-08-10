import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { Logo, Symbol } from "@/components/brand/Logo";
import { getRepo } from "@/lib/repo";
import { PRODUCT_NAME } from "@/lib/product";
import { AUTH_ERROR_MESSAGES, safeNextPath } from "@/lib/auth/oauth";
import { SESSION_COOKIE } from "@/lib/auth/session";
import styles from "./login.module.css";

const LOGIN_ERROR_MESSAGES: Record<string, string> = {
  ...AUTH_ERROR_MESSAGES,
  auth: "Google 로그인을 마치지 못했어요. 다시 시도해 주세요.",
  config: "로그인 설정을 확인하고 있어요. 잠시 후 다시 시도해 주세요.",
  membership: "연결된 회사가 없어요. 회사 관리자에게 초대를 요청해 주세요.",
  profile: "사용자 정보를 준비하지 못했어요. 다시 로그인해 주세요.",
  provisioning: "회사 접근 권한을 준비하지 못했어요. 잠시 후 다시 시도해 주세요.",
};

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
  const errorMessage = LOGIN_ERROR_MESSAGES[errorCode];
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
              <strong>회사의 모든 업무</strong>
              <small>한곳에서 이어지는 흐름</small>
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
            title="회사 업무"
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
              로그인하면 권한과 가입한 회사 수를 확인해
              <br /> 모드를 고르거나 회사 업무를 시작할 화면으로 이동해요.
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
