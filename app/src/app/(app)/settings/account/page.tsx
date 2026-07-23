import { AccountHub } from "@/components/account/AccountHub";
import { AccountNav } from "@/components/account/AccountNav";
import styles from "@/components/account/account.module.css";
import { getSession } from "@/lib/auth/session";
import { buildAccountViewModel } from "@/lib/account/presentation";

const NAV_ITEMS = [
  { key: "account", label: "내 정보", href: "/account" },
  {
    key: "workspace",
    label: "회사와 팀",
    href: "/settings/account#workspace",
  },
  {
    key: "sessions",
    label: "로그인 기기",
    href: "/settings/account/sessions",
  },
  {
    key: "privacy",
    label: "개인정보",
    href: "/settings/account/privacy",
  },
] as const;

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const ctx = await getSession();
  const account = buildAccountViewModel(ctx);
  const { error } = await searchParams;

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <h1>내 계정과 팀</h1>
        <p>내 정보와 지금 함께 일하는 회사를 확인해요.</p>
      </header>

      {error === "signout" ? (
        <section className={`${styles.state} ${styles.blocked}`} role="alert">
          <h2>로그아웃하지 못했어요</h2>
          <p>현재 로그인은 그대로예요. 잠시 뒤 다시 시도해 주세요.</p>
        </section>
      ) : null}

      <AccountNav current="account" items={NAV_ITEMS} />
      <AccountHub
        account={account}
        links={{
          workspace: "/settings/account#workspace",
          sessions: "/settings/account/sessions",
          privacy: "/settings/account/privacy",
        }}
      />
    </div>
  );
}
