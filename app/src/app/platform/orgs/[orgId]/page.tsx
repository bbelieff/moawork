// T07 · /platform/orgs/[orgId] — 고객사 상세.
//
// 노출 범위(P0):
//   · 계약 상대 정보 — 전부 노출하되 연락처·사업자번호는 **마스킹 + [전체보기] 1클릭**.
//   · 고객의 고객 데이터(업체 8,400건) — **열람 권한 필요** → P0 차단(자리만 안내).
//   · 홈택스 — **항상 차단**(등급 무관, 예외 없음).
// 활동 수치는 야간 배치 롤업에서만 온다. 여기서 업무 테이블을 조회하지 않는다.

import { notFound } from "next/navigation";
import Link from "next/link";
import { MaskedValue } from "@/components/platform/MaskedValue";
import {
  ComingSoon,
  Panel,
  PlatformShell,
  StatCard,
  platformStyles as styles,
} from "@/components/platform/PlatformShell";
import { requirePlatformAdmin } from "@/lib/platform/guard";
import { listOrgOverview, platformClient } from "@/lib/platform/server";
import { classifyHealth, idleDaysSince, ratio } from "@/lib/platform/metrics";
import { decideDataAccess, maskBizRegNo, maskEmail, maskName, maskPhone } from "@/lib/platform/access";
import { HEALTH_LABEL, count, day, idleLabel, percent } from "@/lib/platform/format";

export const dynamic = "force-dynamic";

const HEALTH_CLASS = {
  dormant: styles.badgeDormant,
  slowing: styles.badgeSlowing,
  active: styles.badgeActive,
} as const;

export default async function PlatformOrgDetailPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const level = await requirePlatformAdmin();
  const { orgId } = await params;
  const client = await platformClient();

  // 내부 조직도 상세는 열람 가능해야 하므로 include_internal=true 로 받는다.
  const org = (await listOrgOverview(client, true)).find((o) => o.orgId === orgId);
  if (!org) notFound();

  const now = new Date();
  const health = classifyHealth(org.lastActivityAt, now);
  const idle = idleDaysSince(org.lastActivityAt, now);

  const records = decideDataAccess(level, "customerRecords");
  const hometax = decideDataAccess(level, "hometax");

  return (
    <PlatformShell
      level={level}
      pathname="/platform/orgs"
      title={org.name}
      description="계약 상대 정보와 활동 요약입니다. 고객사의 업무 데이터는 포함되지 않습니다."
    >
      <p style={{ marginTop: "-0.5rem", marginBottom: "1rem" }}>
        <Link href="/platform/orgs" className={styles.tab}>
          ← 고객사 목록
        </Link>
        {org.isInternal ? (
          <span
            className={`${styles.badge} ${styles.badgeInternal}`}
            style={{ marginLeft: "0.5rem" }}
          >
            내부 조직
          </span>
        ) : null}
      </p>

      <div className={styles.cards}>
        <StatCard
          label="상태"
          value={HEALTH_LABEL[health]}
          hint={idleLabel(idle)}
        />
        <StatCard label="멤버" value={count(org.memberCount)} hint="전체 인원" />
        <StatCard
          label="활성/전체"
          value={`${count(org.activeUsers7d)}/${count(org.memberCount)}`}
          hint={percent(ratio(org.activeUsers7d, org.memberCount))}
        />
        <StatCard label="7일 쓰기" value={count(org.writes7d)} hint="최근 7일" />
      </div>

      <Panel title="계약 상대 정보" note="어깨너머 방지 — 기본 마스킹, [전체보기]로 확인">
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <tbody>
              <tr>
                <th scope="row">회사명</th>
                <td>{org.name}</td>
              </tr>
              <tr>
                <th scope="row">요금제</th>
                <td>{org.planTier || "—"}</td>
              </tr>
              <tr>
                <th scope="row">가입일</th>
                <td>{day(org.createdAt)}</td>
              </tr>
              <tr>
                <th scope="row">마지막 활동</th>
                <td>
                  {day(org.lastActivityAt)}{" "}
                  <span className={`${styles.badge} ${HEALTH_CLASS[health]}`}>
                    {HEALTH_LABEL[health]}
                  </span>
                </td>
              </tr>
              {/*
                아래 3개는 billing_accounts(009) 가 채워지기 전까지 값이 없다.
                마스킹 컴포넌트는 값이 없으면 '—' 만 보이고 [전체보기] 버튼도 내지 않는다.
              */}
              <tr>
                <th scope="row">대표자</th>
                <td>
                  <MaskedValue masked={maskName(null)} full={null} label="대표자" />
                </td>
              </tr>
              <tr>
                <th scope="row">연락처</th>
                <td>
                  <MaskedValue masked={maskPhone(null)} full={null} label="연락처" />
                </td>
              </tr>
              <tr>
                <th scope="row">사업자등록번호</th>
                <td>
                  <MaskedValue
                    masked={maskBizRegNo(null)}
                    full={null}
                    label="사업자등록번호"
                  />
                </td>
              </tr>
              <tr>
                <th scope="row">청구 이메일</th>
                <td>
                  <MaskedValue masked={maskEmail(null)} full={null} label="청구 이메일" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className={styles.notice} style={{ marginTop: "0.75rem" }}>
          결제 정보(billing_accounts)는 결제 모듈이 채워진 뒤 표시됩니다.
        </p>
      </Panel>

      <Panel title="고객사 업무 데이터" note="열람 권한 필요">
        <ComingSoon>{records.reason}</ComingSoon>
      </Panel>

      <Panel title="홈택스 연동" note="항상 차단">
        <ComingSoon>{hometax.reason}</ComingSoon>
      </Panel>
    </PlatformShell>
  );
}
