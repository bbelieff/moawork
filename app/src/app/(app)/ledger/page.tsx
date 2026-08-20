import { getSession } from "@/lib/auth/session";
import { loadLedgerScreen, YearlyLedgerReadError, type LedgerScreenData } from "@/lib/accounting/yearlyServer";
import { LedgerScreen } from "@/components/accounting/LedgerScreen";
import styles from "@/components/accounting/accounting.module.css";

/** 출력 도장의 날짜 — 서버에서 정해 내려야 클라이언트 렌더와 어긋나지 않는다. */
function todayInSeoul(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default async function LedgerPage() {
  const ctx = await getSession();

  // 데이터 조회만 try/catch 로 감싼다 — JSX 를 그 안에서 만들면 react-hooks/error-boundaries
  // 가 막는다(렌더 오류는 여기서 안 잡히므로 오해를 부른다). 판정은 값으로 남기고 렌더는 밖에서.
  let screen: LedgerScreenData | null = null;
  try {
    screen = await loadLedgerScreen(ctx);
  } catch (error) {
    if (!(error instanceof YearlyLedgerReadError)) throw error;
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      {screen ? (
        <LedgerScreen
          years={screen.years}
          rows={screen.rows}
          printedOn={todayInSeoul()}
          printedBy={ctx.user.name ?? ctx.org.name}
        />
      ) : (
        <section role="alert" aria-label="연도별 원장" className={`${styles.notice} ${styles.noticeFailed}`}>
          원장을 불러오지 못했어요. 잠시 후 다시 확인해 주세요.
        </section>
      )}
    </main>
  );
}
