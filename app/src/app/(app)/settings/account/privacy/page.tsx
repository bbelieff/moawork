import { AccountNav } from "@/components/account/AccountNav";
import { AccountState } from "@/components/account/AccountState";
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

export default async function AccountPrivacyPage() {
  await getSession();

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <h1>개인정보와 데이터</h1>
        <p>내 계정 정보와 회사 업무 자료는 서로 다르게 보호해요.</p>
      </header>
      <AccountNav current="privacy" items={NAV_ITEMS} />
      <AccountState
        kind="blocked"
        title="개인정보 기능을 안전하게 준비하고 있어요"
        message="내 정보 보기, 데이터 내려받기, 계정 탈퇴는 본인 확인과 보존 정책이 준비된 뒤 열어요. 지금은 바뀌는 내용이 없어요."
        actionHref="/account"
        actionLabel="내 계정으로 돌아가기"
      />
    </div>
  );
}
