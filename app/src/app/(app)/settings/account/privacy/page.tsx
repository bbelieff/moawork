import { AccountNav } from "@/components/account/AccountNav";
import { AccountState } from "@/components/account/AccountState";
import styles from "@/components/account/account.module.css";
import { getSession } from "@/lib/auth/session";
import { getMyPrivacyAccountData } from "@/lib/account/memberAccountOps";
import { requestPrivacyExport } from "../actions";

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
  const ctx = await getSession();
  let data: Record<string, unknown> | null = null;
  try { data = await getMyPrivacyAccountData(ctx.org.id); } catch { data = null; }

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <h1>개인정보와 데이터</h1>
        <p>내 계정 정보와 회사 업무 자료는 서로 다르게 보호해요.</p>
      </header>
      <AccountNav current="privacy" items={NAV_ITEMS} />
      {data ? <section aria-label="내 개인정보"><p>본인 계정과 현재 워크스페이스 프로필만 표시합니다.</p><pre>{JSON.stringify(data, null, 2)}</pre><form action={requestPrivacyExport}><button type="submit">내 데이터 내보내기 요청</button></form></section> : <AccountState kind="blocked" title="개인정보를 불러오지 못했습니다" message="잠시 후 다시 시도해 주세요." />}
    </div>
  );
}
