// T07 · /platform/system — 시스템.
//
// 배치 상태·집계 신선도를 보여준다. 여기서도 고객 업무 데이터는 조회하지 않는다.

import {
  Panel,
  PlatformShell,
  StatCard,
  platformStyles as styles,
} from "@/components/platform/PlatformShell";
import { requirePlatformAdmin } from "@/lib/platform/guard";
import { listMetricsRange, platformClient } from "@/lib/platform/server";
import { daysAgo } from "@/lib/platform/metrics";
import { count, day } from "@/lib/platform/format";

export const dynamic = "force-dynamic";

export default async function PlatformSystemPage() {
  const level = await requirePlatformAdmin();
  const now = new Date();
  const rows = await listMetricsRange(
    await platformClient(),
    daysAgo(29, now),
    daysAgo(0, now),
    true,
  );

  // 집계 신선도 — 롤업이 멈추면 여기서 먼저 드러난다.
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const latest = dates.at(-1) ?? null;
  const staleDays =
    latest === null
      ? null
      : Math.max(
          0,
          Math.floor(
            (Date.parse(`${daysAgo(0, now)}T00:00:00Z`) - Date.parse(`${latest}T00:00:00Z`)) /
              86_400_000,
          ),
        );

  return (
    <PlatformShell
      level={level}
      pathname="/platform/system"
      title="시스템"
      description="야간 배치와 집계 신선도를 확인합니다."
    >
      <div className={styles.cards}>
        <StatCard
          label="최근 집계일"
          value={latest ? day(latest) : "—"}
          hint={latest ? `${count(staleDays ?? 0)}일 지연` : "집계 이력 없음"}
        />
        <StatCard label="집계된 날" value={count(dates.length)} hint="최근 30일 중" />
        <StatCard label="롤업 행" value={count(rows.length)} hint="조직×일자" />
        <StatCard
          label="배치 상태"
          value={staleDays !== null && staleDays <= 1 ? "정상" : "확인 필요"}
          hint="어제 이후 집계가 있으면 정상"
        />
      </div>

      <Panel title="배치 구성">
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <tbody>
              <tr>
                <th scope="row">잡</th>
                <td>platform.metrics.rollup (pg-boss)</td>
              </tr>
              <tr>
                <th scope="row">주기</th>
                <td>매일 03:10 KST (cron <code>10 18 * * *</code> UTC)</td>
              </tr>
              <tr>
                <th scope="row">대상</th>
                <td>전일 1일치 + 최근 3일 재계산(지각 데이터 보정)</td>
              </tr>
              <tr>
                <th scope="row">멱등</th>
                <td>
                  <code>(date, org_id)</code> upsert — 여러 번 돌려도 결과가 같습니다
                </td>
              </tr>
              <tr>
                <th scope="row">저장소</th>
                <td>
                  <code>platform_metrics_daily</code> (014)
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className={styles.notice} style={{ marginTop: "0.75rem" }}>
          화면은 이 테이블만 읽습니다. 요청 시점 실시간 집계는 하지 않습니다.
        </p>
      </Panel>
    </PlatformShell>
  );
}
