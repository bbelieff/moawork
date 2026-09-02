import { AccountNav } from "@/components/account/AccountNav";
import { AccountState } from "@/components/account/AccountState";
import styles from "@/components/account/account.module.css";
import { getSession } from "@/lib/auth/session";
import { getMyPrivacyAccountData } from "@/lib/account/memberAccountOps";
import { isMemberRole, isMemberScope, roleLabel, scopeLabel } from "@/lib/auth/roles";
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

type PrivacyDisplayRow = {
  label: string;
  value: string;
};

/*
 * ★ 이름표를 손으로 적지 않는다 — 정본은 lib/auth/roles.ts 다.
 *
 *   전에는 여기에 세 줄이 적혀 있었고 «두 군데가 틀렸다»:
 *     admin → 「팀장」          관리자인 사람이 자기 화면에서 팀장으로 읽혔다
 *     team_lead 가 아예 없음   팀장인 사람은 자기 역할이 「확인할 수 없어요」로 떴다
 *                             — 우리는 알고 있는데도.
 *
 *   여기는 «개인정보와 데이터» 화면이다. 자기 권한이 무엇인지 확인하러 오는 곳에서
 *   틀린 역할을 보여주는 것은 다른 화면에서보다 더 나쁘다.
 */

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildPrivacyDisplayRows(data: Record<string, unknown>): PrivacyDisplayRow[] {
  const identity = readRecord(data.identity);
  const companyProfile = readRecord(data.workspace_profile);
  const role = readText(companyProfile?.role);
  const scope = readText(companyProfile?.scope);

  return [
    { label: "이름", value: readText(identity?.name) ?? "등록되지 않았어요" },
    { label: "이메일", value: readText(identity?.email) ?? "연결되지 않았어요" },
    { label: "회사 역할", value: isMemberRole(role) ? roleLabel(role) : "확인할 수 없어요" },
    { label: "볼 수 있는 업무", value: isMemberScope(scope) ? scopeLabel(scope) : "확인할 수 없어요" },
    { label: "직책", value: readText(companyProfile?.title) ?? "등록되지 않았어요" },
    { label: "팀", value: readText(companyProfile?.team_key) ?? "배정되지 않았어요" },
  ];
}

export default async function AccountPrivacyPage() {
  const ctx = await getSession();
  let data: Record<string, unknown> | null = null;
  try { data = await getMyPrivacyAccountData(ctx.org.id); } catch { data = null; }

  const displayRows = data ? buildPrivacyDisplayRows(data) : [];

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <h1>내 개인정보</h1>
        <p>로그인 정보와 회사 업무 자료는 나누어 보호해요.</p>
      </header>
      <AccountNav current="privacy" items={NAV_ITEMS} />
      {data ? <section aria-label="내 개인정보"><p>내 로그인 정보와 현재 회사에서 사용하는 내 정보만 보여드려요.</p><dl>{displayRows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl><form action={requestPrivacyExport}><button type="submit">내 정보 내보내기 요청하기</button></form></section> : <AccountState kind="blocked" title="개인정보를 불러오지 못했어요" message="잠시 후 이 화면을 다시 열어 주세요." />}
    </div>
  );
}
