// T07 · /platform/billing — 결제·매출.
//
// P0 = 스키마 + 화면 골격. PG 실연동은 Phase 2 이므로 실제 결제는 일어나지 않는다.
// 한국 SaaS 필수 항목을 화면에 고정한다: **부가세 분리** · **전자세금계산서 상태**.
// MRR/ARR/NRR 은 배치가 채운 청구 데이터에서 파생한다(실시간 집계 없음).

import {
  ComingSoon,
  Panel,
  PlatformShell,
  StatCard,
  platformStyles as styles,
} from "@/components/platform/PlatformShell";
import { requirePlatformAdmin } from "@/lib/platform/guard";
import { listBillingMonthly, platformClient } from "@/lib/platform/server";
import { revenueMetrics } from "@/lib/platform/metrics";
import { EXPORT_FORMATS, billingExport } from "@/lib/platform/export";
import { can } from "@/lib/platform/access";
import { count, day, krw, percent } from "@/lib/platform/format";

export const dynamic = "force-dynamic";

export default async function PlatformBillingPage() {
  const level = await requirePlatformAdmin();
  const client = await platformClient();

  const rows = await listBillingMonthly(client, 12);
  const revenue = revenueMetrics(rows);
  const canExport = can(level, "exportBilling");
  const period = new Date().toISOString().slice(0, 7);

  return (
    <PlatformShell
      level={level}
      pathname="/platform/billing"
      title="결제·매출"
      description="P0는 스키마와 화면 골격입니다. PG 실연동은 Phase 2에서 붙습니다."
    >
      <div className={styles.cards}>
        <StatCard label="MRR" value={krw(revenue.mrr)} hint="공급가액 기준(부가세 제외)" />
        <StatCard label="ARR" value={krw(revenue.arr)} hint="MRR × 12" />
        <StatCard
          label="NRR"
          value={percent(revenue.nrr)}
          hint={revenue.nrr === null ? "전월 매출 없음 — 산출 불가" : "전월 대비"}
        />
        <StatCard label="미수금" value={krw(revenue.outstanding)} hint="청구 − 수납" />
      </div>

      <Panel title="월별 청구" note="공급가액·부가세 분리 보관">
        {rows.length === 0 ? (
          <p className={styles.empty}>
            청구 데이터가 없습니다 — 결제 모듈이 붙으면 표시됩니다.
          </p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>월</th>
                  <th className={styles.num}>청구건수</th>
                  <th className={styles.num}>공급가액</th>
                  <th className={styles.num}>부가세</th>
                  <th className={styles.num}>합계</th>
                  <th className={styles.num}>수납액</th>
                  <th className={styles.num}>미수금</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.month}>
                    <td>{day(r.month)}</td>
                    <td className={styles.num}>{count(r.invoiceCount)}</td>
                    <td className={styles.num}>{krw(r.supplySum)}</td>
                    <td className={styles.num}>{krw(r.vatSum)}</td>
                    <td className={styles.num}>{krw(r.totalSum)}</td>
                    <td className={styles.num}>{krw(r.paidSum)}</td>
                    <td className={styles.num}>
                      {krw(Math.max(0, r.totalSum - r.paidSum))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="내보내기" note={canExport ? "3형식" : "operator 이상만 가능"}>
        <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.875rem" }}>
          {EXPORT_FORMATS.map((format) => {
            const d = billingExport(rows, format, period);
            return (
              <li key={format} style={{ marginBottom: "0.25rem" }}>
                <strong>{format.toUpperCase()}</strong> — {d.filename}{" "}
                <span
                  className={`${styles.badge} ${
                    d.ready && canExport ? styles.badgeActive : styles.badgeMuted
                  }`}
                >
                  {!canExport ? "권한 필요" : d.ready ? "사용 가능" : "준비 중"}
                </span>
                {format === "csv" ? (
                  <span style={{ color: "var(--plat-muted)" }}> · UTF-8 BOM(엑셀 한글)</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel title="전자세금계산서" note="상태만 보관 · 발행은 홈택스 트랙(T08)">
        <ComingSoon>
          발행 상태(요청/발행/실패)는 invoices.tax_invoice_status 에 보관합니다. 실제 발행
          연동은 홈택스 모듈이 붙은 뒤 동작합니다.
        </ComingSoon>
      </Panel>
    </PlatformShell>
  );
}
