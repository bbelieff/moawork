import { getSession } from "@/lib/auth/session";
import { loadYearlyLedgerView, YearlyLedgerReadError } from "@/lib/accounting/yearlyServer";
import { YearlyLedgerView } from "@/components/accounting/YearlyLedgerView";
import type { YearlyLedgerYearGroup } from "@/lib/accounting/yearly";
import styles from "@/components/accounting/accounting.module.css";

export default async function LedgerPage() {
  const ctx = await getSession();

  // 데이터 조회만 try/catch 로 감싼다 — JSX 를 그 안에서 만들면 react-hooks/error-boundaries
  // 가 막는다(렌더 오류는 여기서 안 잡히므로 오해를 부른다). 판정은 값으로 남기고 렌더는 밖에서.
  let groups: readonly YearlyLedgerYearGroup[] | null = null;
  try {
    groups = await loadYearlyLedgerView(ctx);
  } catch (error) {
    if (!(error instanceof YearlyLedgerReadError)) throw error;
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      {groups ? (
        <YearlyLedgerView groups={groups} />
      ) : (
        <section role="alert" aria-label="연도별 원장" className={`${styles.notice} ${styles.noticeFailed}`}>
          원장을 불러오지 못했어요. 잠시 후 다시 확인해 주세요.
        </section>
      )}
    </main>
  );
}
