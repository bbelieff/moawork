// T07 · /platform 개요.
//
// 모든 수치는 야간 배치가 채운 `platform_metrics_daily` 에서 온다(실시간 집계 없음).
// 고객 업무 데이터는 조회하지 않는다 — 건수·시각·사용자 수만.

import Link from "next/link";
import { Panel, PlatformShell, StatCard, platformStyles as styles } from "@/components/platform/PlatformShell";
import { requirePlatformAdmin } from "@/lib/platform/guard";
import {
  listMetricsRange,
  listOrgOverview,
  listTtfv,
  platformClient,
} from "@/lib/platform/server";
import {
  activityMetrics,
  daysAgo,
  healthMetrics,
  inputMetrics,
  sortByRisk,
  ttfvMetrics,
} from "@/lib/platform/metrics";
import { HEALTH_LABEL, count, duration, idleLabel, percent } from "@/lib/platform/format";

export const dynamic = "force-dynamic";

export default async function PlatformOverviewPage() {
  const level = await requirePlatformAdmin();
  const client = await platformClient();
  const now = new Date();

  const [orgs, metrics, ttfvRows] = await Promise.all([
    listOrgOverview(client),
    listMetricsRange(client, daysAgo(29, now), daysAgo(0, now)),
    listTtfv(client),
  ]);

  const activity = activityMetrics(metrics, now);
  const input = inputMetrics(metrics);
  const ttfv = ttfvMetrics(ttfvRows);
  // 미처리 가입요청은 T03 의 workspace-entry 큐가 정본이라 여기서는 0으로 둔다.
  const health = healthMetrics(orgs, metrics, 0, now);
  const risky = sortByRisk(orgs, now).slice(0, 5);

  return (
    <PlatformShell
      level={level}
      pathname="/platform"
      title="개요"
      description="야간 배치가 집계한 최근 30일 지표입니다. 고객 업무 데이터는 포함되지 않습니다."
    >
      <div className={styles.cards}>
        <StatCard label="DAU" value={count(activity.dau)} hint="오늘 활동 사용자" />
        <StatCard label="WAU" value={count(activity.wau)} hint="최근 7일" />
        <StatCard label="MAU" value={count(activity.mau)} hint="최근 30일" />
        <StatCard
          label="스티키니스"
          value={percent(activity.stickiness)}
          hint="DAU ÷ MAU"
        />
      </div>

      <div className={styles.cards}>
        <StatCard label="쓰기 이벤트" value={count(input.writes)} hint="최근 30일 합계" />
        <StatCard
          label="조직 일평균"
          value={input.writesPerOrgPerDay.toFixed(1)}
          hint="조직당 하루 쓰기"
        />
        <StatCard
          label="TTFV 중앙값"
          value={duration(ttfv.medianHours)}
          hint={`가입→첫 딜 · ${count(ttfv.converted)}/${count(ttfv.total)} 전환`}
        />
        <StatCard
          label="휴면 조직"
          value={count(health.dormantOrgs)}
          hint="14일 무활동"
        />
      </div>

      <div className={styles.cards}>
        <StatCard label="오류율" value={percent(health.errorRate, 2)} hint="오류 ÷ 쓰기" />
        <StatCard label="리텐션 W1" value={percent(health.retentionW1)} />
        <StatCard label="리텐션 W4" value={percent(health.retentionW4)} />
        <StatCard label="집계 조직" value={count(orgs.length)} hint="내부 조직 제외" />
      </div>

      <Panel title="손볼 회사 (위험순 상위 5)" note="휴면 → 둔화 → 활발">
        {risky.length === 0 ? (
          <p className={styles.empty}>표시할 회사가 없습니다 —</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>회사</th>
                  <th>상태</th>
                  <th>마지막 활동</th>
                  <th className={styles.num}>7일 쓰기</th>
                  <th className={styles.num}>활성/전체</th>
                </tr>
              </thead>
              <tbody>
                {risky.map((o) => (
                  <tr key={o.orgId}>
                    <td>{o.name}</td>
                    <td>
                      <span
                        className={`${styles.badge} ${
                          o.health === "dormant"
                            ? styles.badgeDormant
                            : o.health === "slowing"
                              ? styles.badgeSlowing
                              : styles.badgeActive
                        }`}
                      >
                        {HEALTH_LABEL[o.health]}
                      </span>
                    </td>
                    <td>{idleLabel(o.idleDays)}</td>
                    <td className={styles.num}>{count(o.writes7d)}</td>
                    <td className={styles.num}>
                      {count(o.activeUsers7d)}/{count(o.memberCount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p style={{ marginTop: "0.75rem" }}>
          <Link href="/platform/orgs" className={styles.tab}>
            고객사 관리 전체 보기 →
          </Link>
        </p>
      </Panel>
    </PlatformShell>
  );
}
