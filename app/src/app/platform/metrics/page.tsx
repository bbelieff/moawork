import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/brand/Logo";
import styles from "@/components/workspace-entry/workspace-entry.module.css";
import { loadWorkspaceRoutingSnapshot } from "@/lib/auth/workspace-entry-server";
import { loadWorkspaceEntryContext } from "@/lib/workspace-entry/server";
import { groupByDay, readRecentMetrics } from "@/lib/metrics/read";
import { platformTotals } from "@/lib/metrics";

/**
 * 플랫폼 지표 콘솔 (C4 · T04).
 *
 * 읽기 전용이며 **야간 배치가 적재한 스냅샷만** 본다 —
 * 전 조직 원본을 실시간으로 훑지 않는다(P0 O5 / 공격테스트 11).
 * 표시 대상은 전부 집계 수치이며 사용자·딜 식별자는 이 화면에 오지 않는다.
 *
 * 게이트는 workspace-requests 와 동일: 미인증 → /login, 비관리자 → /workspace-entry.
 */
export default async function PlatformMetricsPage() {
  const routing = await loadWorkspaceRoutingSnapshot();
  if (routing.kind === "unauthenticated") redirect("/login?next=/platform/metrics");
  const context = await loadWorkspaceEntryContext();
  if (context.kind === "error" || !context.isPlatformAdmin)
    redirect("/workspace-entry?error=permission");

  const snapshot = await readRecentMetrics(14);
  const groups = groupByDay(snapshot.rows);
  const latest = groups[0];
  const totals = latest ? platformTotals(latest.rows) : null;

  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

  return (
    <main className={styles.page}>
      <section className={`${styles.shell} ${styles.compactShell}`}>
        <header className={styles.protoTop}>
          <Logo height={28} />
          <span>플랫폼 운영 영역</span>
        </header>

        <div className={styles.compactHub}>
          <section aria-labelledby="metrics-title">
            <p>플랫폼 운영</p>
            <h1 id="metrics-title">제품 사용 지표</h1>
            <p>
              매일 새벽 배치가 집계한 수치만 보여줘요. 고객사의 업무 내용, 멤버 이름,
              고객 정보는 이 화면에 오지 않아요.
            </p>
          </section>

          <nav aria-label="플랫폼 운영 탐색">
            <Link href="/platform/workspace-requests">회사 만들기 요청</Link>
            <Link href="/platform/metrics">제품 사용 지표</Link>
            <Link href="/account">내 계정</Link>
          </nav>

          {/* 상태를 구분해 말한다 — 미연결·오류·미집계는 서로 다른 상황이다. */}
          {snapshot.status === "not_configured" ? (
            <section aria-labelledby="state-title">
              <h2 id="state-title">집계 데이터 없음</h2>
              <p>
                데이터베이스가 연결되지 않았어요. 플랫폼 지표는 실제 운영 데이터에서만
                만들어지므로 임시 값으로 대신 보여주지 않습니다.
              </p>
            </section>
          ) : snapshot.status === "error" ? (
            <section aria-labelledby="state-title">
              <h2 id="state-title">지표를 불러오지 못했어요</h2>
              <p>사유: {snapshot.message}</p>
              <p>수치를 0으로 가정하지 않습니다. 잠시 후 다시 시도해 주세요.</p>
            </section>
          ) : !latest || !totals ? (
            <section aria-labelledby="state-title">
              <h2 id="state-title">아직 집계된 날짜가 없어요</h2>
              <p>
                야간 배치가 아직 한 번도 실행되지 않았거나 최근 14일 기록이 없습니다.
                배치는 매일 새벽 4시(KST)에 전날 하루를 집계해요.
              </p>
            </section>
          ) : (
            <>
              <section aria-labelledby="latest-title">
                <h2 id="latest-title">최근 집계일 · {latest.day}</h2>
                <ul>
                  <li>
                    스티키니스(DAU/MAU): <strong>{pct(totals.stickiness)}</strong>
                  </li>
                  <li>
                    활성 사용자 합: <strong>{totals.dauSum}</strong> (일) ·{" "}
                    <strong>{totals.mauSum}</strong> (30일)
                  </li>
                  <li>
                    멤버 상태: 활성 <strong>{totals.activeUsers}</strong> · 휴면{" "}
                    <strong>{totals.dormantUsers}</strong>
                  </li>
                  <li>
                    신규 딜: <strong>{totals.newDeals}</strong> · 집계 조직{" "}
                    <strong>{totals.orgs}</strong>곳
                  </li>
                </ul>
                <p>
                  사용자 수는 조직별 고유 사용자를 더한 값이에요. 한 사람이 두 회사에
                  속하면 두 번 세어집니다.
                </p>
              </section>

              <section aria-labelledby="trend-title">
                <h2 id="trend-title">최근 추이</h2>
                <table>
                  <caption>날짜별 플랫폼 합계 (최근 14일, 집계된 날짜만)</caption>
                  <thead>
                    <tr>
                      <th scope="col">날짜</th>
                      <th scope="col">조직</th>
                      <th scope="col">DAU 합</th>
                      <th scope="col">MAU 합</th>
                      <th scope="col">스티키니스</th>
                      <th scope="col">휴면</th>
                      <th scope="col">신규 딜</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g) => {
                      const t = platformTotals(g.rows);
                      return (
                        <tr key={g.day}>
                          <th scope="row">{g.day}</th>
                          <td>{t.orgs}</td>
                          <td>{t.dauSum}</td>
                          <td>{t.mauSum}</td>
                          <td>{pct(t.stickiness)}</td>
                          <td>{t.dormantUsers}</td>
                          <td>{t.newDeals}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
