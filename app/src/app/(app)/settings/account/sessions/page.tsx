import { AccountNav } from "@/components/account/AccountNav";
import { AccountState } from "@/components/account/AccountState";
import { CurrentSessionLogout } from "@/components/account/CurrentSessionLogout";
import styles from "@/components/account/account.module.css";
import { getSession } from "@/lib/auth/session";

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

export default async function AccountSessionsPage() {
  await getSession();

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <h1>로그인 기기</h1>
        <p>지금 사용하는 브라우저의 로그인을 안전하게 끝낼 수 있어요.</p>
      </header>
      <AccountNav current="sessions" items={NAV_ITEMS} />
      <AccountState
        kind="blocked"
        title="로그인 기기 기능을 준비하고 있어요"
        message="로그인 기기 정보를 안전하게 확인하는 기능을 준비하고 있어요. 지금 기기에서는 로그아웃할 수 있어요."
      />
      <div className={styles.actionRow}>
        <CurrentSessionLogout />
      </div>
    </div>
  );
}
