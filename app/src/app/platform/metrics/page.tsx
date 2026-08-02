// T07 · /platform/metrics — 지표 상세.
//
// 정본은 `platform_metrics_daily`(야간 배치 롤업). 실시간 집계는 하지 않는다.
// 화면이 표시하는 모든 값은 이미 계산된 수치이며, 고객 업무 데이터의 내용은 없다.

import {
  Panel,
  PlatformShell,
  StatCard,
  platformStyles as styles,
} from "@/components/platform/PlatformShell";
import { requirePlatformAdmin } from "@/lib/platform/guard";
import { listMetricsRange, listOrgOverview, listTtfv, platformClient } from "@/lib/platform/server";
import {
  activityMetrics,
  daysAgo,
  healthMetrics,
  inputMetrics,
  ttfvMetrics,
} from "@/lib/platform/metrics";
import { count, day, duration, percent } from "@/lib/platform/format";

export const dynamic = "force-dynamic";

export default async function PlatformMetricsPage() {
  const level = await requirePlatformAdmin();
  const client = await platformClient();
  const now = new Date();
  const from = daysAgo(29, now);
  const to = daysAgo(0, now);

  const [orgs, metrics, ttfvRows] = await Promise.all([
    listOrgOverview(client),
    listMetricsRange(client, from, to),
    listTtfv(client),
  ]);

  const activity = activityMetrics(metrics, now);
  const input = inputMetrics(metrics);
  const ttfv = ttfvMetrics(ttfvRows);
  const health = healthMetrics(orgs, metrics, 0, now);

  // 일자별 합계 — 최근 14일만 표로 보여준다(그 이상은 스크롤만 길어진다).
  const byDate = new Map<string, { writes: number; active: number; errors: number }>();
  for (const r of metrics) {
    const acc = byDate.get(r.date) ?? { writes: 0, active: 0, errors: 0 };
    acc.writes += r.writes;
    acc.active += r.activeUsers;
    acc.errors += r.errors;
    byDate.set(r.date, acc);
  }
  const recent = [...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 14);

  return (
    <PlatformShell
      level={level}
      pathname="/platform/metrics"
      title="지표"
      description={`야간 배치 집계 · ${from} ~ ${to} · 내부 조직 제외`}
    >
      <Panel title="활성" note="스티키니스 = DAU ÷ MAU">
        <div className={styles.cards}>
          <StatCard label="DAU" value={count(activity.dau)} />
          <StatCard label="WAU" value={count(activity.wau)} />
          <StatCard label="MAU" value={count(activity.mau)} />
          <StatCard label="스티키니스" value={percent(activity.stickiness)} />
        </div>
      </Panel>

      <Panel title="입력량" note="쓰기 이벤트 = 활동기록 + 감사로그 + 신규 딜">
        <div className={styles.cards}>
          <StatCard label="쓰기 총합" value={count(input.writes)} hint="30일" />
          <StatCard
            label="조직 일평균"
            value={input.writesPerOrgPerDay.toFixed(1)}
            hint={`${count(input.orgCount)}개 조직 · ${count(input.days)}일`}
          />
          <StatCard
            label="TTFV 중앙값"
            value={duration(ttfv.medianHours)}
            hint="가입 → 첫 딜 등록"
          />
          <StatCard
            label="TTFV 평균"
            value={duration(ttfv.meanHours)}
            hint={`${count(ttfv.converted)}/${count(ttfv.total)} 전환`}
          />
        </div>
      </Panel>

      <Panel title="건강도">
        <div className={styles.cards}>
          <StatCard label="휴면 조직" value={count(health.dormantOrgs)} hint="14일 무활동" />
          <StatCard label="오류율" value={percent(health.errorRate, 2)} />
          <StatCard label="리텐션 W1" value={percent(health.retentionW1)} />
          <StatCard label="리텐션 W4" value={percent(health.retentionW4)} />
        </div>
      </Panel>

      <Panel title="일자별 추이" note="최근 14일">
        {recent.length === 0 ? (
          <p className={styles.empty}>
            아직 집계된 데이터가 없습니다 — 야간 배치가 한 번 돌면 표시됩니다.
          </p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>일자</th>
                  <th className={styles.num}>활성 사용자</th>
                  <th className={styles.num}>쓰기</th>
                  <th className={styles.num}>오류</th>
                </tr>
              </thead>
              <tbody>
                {recent.map(([date, v]) => (
                  <tr key={date}>
                    <td>{day(date)}</td>
                    <td className={styles.num}>{count(v.active)}</td>
                    <td className={styles.num}>{count(v.writes)}</td>
                    <td className={styles.num}>{count(v.errors)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </PlatformShell>
  );
}
