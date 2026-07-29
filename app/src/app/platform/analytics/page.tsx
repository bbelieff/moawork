// T07 · /platform/analytics — 운영 분석.
//
// belie 확정 3분면:
//   ① 매출지표        — DB 확정값
//   ② 사용자행동지표  — PostHog 추정값
//   ③ 종합 인사이트   — ①×②(추정)
// 기간 5구간: 주 · 월 · 분기 · 반기 · 연.
//
// ⚠ 메뉴 이름은 "운영 분석"으로 확정됐다. 다른 이름을 붙이지 않는다.
// 활동 수치는 야간 배치 롤업(platform_metrics_daily)에서만 온다 — 실시간 집계 없음.

import Link from "next/link";
import {
  ComingSoon,
  Panel,
  PlatformShell,
  StatCard,
  platformStyles as styles,
} from "@/components/platform/PlatformShell";
import { requirePlatformAdmin } from "@/lib/platform/guard";
import {
  listBillingMonthly,
  listMetricsRange,
  listOrgOverview,
  listTtfv,
  platformClient,
} from "@/lib/platform/server";
import {
  activityMetrics,
  healthMetrics,
  inputMetrics,
  revenueMetrics,
  ttfvMetrics,
} from "@/lib/platform/metrics";
import {
  ANALYTICS_PERIODS,
  PERIOD_LABEL,
  PERIOD_MONTHS,
  parsePeriod,
  periodRange,
} from "@/lib/platform/periods";
import {
  POSTHOG_SERVER_KEY_ENV,
  behaviorFromEnv,
  combineInsight,
} from "@/lib/platform/insight";
import { count, day, duration, krw, percent } from "@/lib/platform/format";

export const dynamic = "force-dynamic";

export default async function PlatformAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const level = await requirePlatformAdmin();
  const period = parsePeriod((await searchParams).period);
  const now = new Date();
  const range = periodRange(period, now);
  const client = await platformClient();

  const [orgs, metrics, ttfvRows, billing] = await Promise.all([
    listOrgOverview(client),
    listMetricsRange(client, range.from, range.to),
    listTtfv(client),
    listBillingMonthly(client, PERIOD_MONTHS[period]),
  ]);

  // ① 매출 — DB 확정값
  const revenue = revenueMetrics(billing);
  // ② 사용자 행동 — PostHog 추정값(서버 키 필요)
  const behavior = behaviorFromEnv(process.env[POSTHOG_SERVER_KEY_ENV]);
  // ③ 종합 — ①×②
  const insight = combineInsight(revenue, behavior);

  const activity = activityMetrics(metrics);
  const input = inputMetrics(metrics);
  const ttfv = ttfvMetrics(ttfvRows);
  const health = healthMetrics(orgs, metrics, 0, now);

  return (
    <PlatformShell
      level={level}
      pathname="/platform/analytics"
      title="운영 분석"
      description={`${PERIOD_LABEL[period]} 기준 · ${range.from} ~ ${range.to} · 내부 조직 제외`}
    >
      <div className={styles.tabs}>
        {ANALYTICS_PERIODS.map((p) => (
          <Link
            key={p}
            href={`/platform/analytics?period=${p}`}
            className={`${styles.tab} ${p === period ? styles.tabActive : ""}`}
            aria-current={p === period ? "page" : undefined}
          >
            {PERIOD_LABEL[p]}
          </Link>
        ))}
      </div>

      {/* ── ① 매출지표 (확정값) ─────────────────────────── */}
      <Panel title="① 매출지표" note="DB 확정값">
        <div className={styles.cards}>
          <StatCard label="MRR" value={krw(revenue.mrr)} hint="공급가액(부가세 제외)" />
          <StatCard label="ARR" value={krw(revenue.arr)} hint="MRR × 12" />
          <StatCard
            label="NRR"
            value={percent(revenue.nrr)}
            hint={revenue.nrr === null ? "전월 매출 없음 — 산출 불가" : "전월 대비"}
          />
          <StatCard label="미수금" value={krw(revenue.outstanding)} hint="청구 − 수납" />
        </div>
        {billing.length === 0 ? (
          <p className={styles.notice}>
            청구 데이터가 아직 없습니다. 결제 모듈이 붙으면 확정값이 채워집니다.
          </p>
        ) : null}
      </Panel>

      {/* ── ② 사용자행동지표 (추정값) ───────────────────── */}
      <Panel title="② 사용자행동지표" note="PostHog 추정값">
        {behavior.available ? (
          <div className={styles.cards}>
            <StatCard label="활성 사용자" value={count(behavior.activeUsers)} hint="추정" />
            <StatCard label="세션" value={count(behavior.sessions)} hint="추정" />
            <StatCard label="신규 가입" value={count(behavior.signups)} hint="추정" />
            <StatCard label="활성화" value={count(behavior.activated)} hint="추정" />
          </div>
        ) : (
          <ComingSoon>{behavior.reason}</ComingSoon>
        )}

        <p className={styles.notice} style={{ marginTop: "0.75rem" }}>
          자체 롤업(확정) 기준 활동 수치는 아래와 같습니다 — PostHog 추정값과 다를 수 있습니다.
        </p>
        <div className={styles.cards} style={{ marginTop: "0.75rem" }}>
          <StatCard
            label="DAU"
            value={count(activity.dau)}
            hint={activity.asOf ? `기준일 ${day(activity.asOf)}` : "집계 없음"}
          />
          <StatCard label="WAU" value={count(activity.wau)} hint="기준일 포함 7일" />
          <StatCard label="MAU" value={count(activity.mau)} hint="기준일 포함 30일" />
          <StatCard
            label="스티키니스"
            value={percent(activity.stickiness)}
            hint="DAU ÷ MAU"
          />
        </div>
      </Panel>

      {/* ── ③ 종합 인사이트 ─────────────────────────────── */}
      <Panel title="③ 종합 인사이트" note="① × ② · 추정값">
        {insight.available ? (
          <>
            <div className={styles.cards}>
              <StatCard label="ARPU" value={krw(insight.arpu)} hint="MRR ÷ 활성 사용자" />
              <StatCard
                label="활성화율"
                value={percent(insight.activationRate)}
                hint="활성화 ÷ 활성 사용자"
              />
              <StatCard
                label="가입당 매출"
                value={krw(insight.revenuePerSignup)}
                hint="MRR ÷ 신규 가입"
              />
              <StatCard
                label="사용자당 세션"
                value={insight.sessionsPerUser.toFixed(1)}
                hint="세션 ÷ 활성 사용자"
              />
            </div>
            <p className={styles.notice} style={{ marginTop: "0.75rem" }}>
              {insight.reason}
            </p>
          </>
        ) : (
          <ComingSoon>
            ②가 준비되면 계산됩니다. 확정값만으로 &quot;종합&quot;을 만들지 않습니다.
            <br />
            {insight.reason}
          </ComingSoon>
        )}
      </Panel>

      {/* ── 보조: 입력량·건강도(자체 롤업 확정값) ───────── */}
      <Panel title="입력량·건강도" note="자체 롤업 확정값">
        <div className={styles.cards}>
          <StatCard label="쓰기 이벤트" value={count(input.writes)} hint={`${PERIOD_LABEL[period]} 합계`} />
          <StatCard
            label="조직 일평균"
            value={input.writesPerOrgPerDay.toFixed(1)}
            hint={`${count(input.orgCount)}개 조직 · ${count(input.days)}일`}
          />
          <StatCard
            label="TTFV 중앙값"
            value={duration(ttfv.medianHours)}
            hint={`가입→첫 딜 · ${count(ttfv.converted)}/${count(ttfv.total)} 전환`}
          />
          <StatCard label="휴면 조직" value={count(health.dormantOrgs)} hint="14일 무활동" />
        </div>
        <div className={styles.cards}>
          <StatCard label="오류율" value={percent(health.errorRate, 2)} hint="오류 ÷ 쓰기" />
          <StatCard label="리텐션 W1" value={percent(health.retentionW1)} />
          <StatCard label="리텐션 W4" value={percent(health.retentionW4)} />
          <StatCard label="집계 조직" value={count(orgs.length)} hint="내부 조직 제외" />
        </div>
      </Panel>
    </PlatformShell>
  );
}
