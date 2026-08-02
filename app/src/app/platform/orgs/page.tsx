// T07 · /platform/orgs — 고객사 관리.
//
// 탭 3개: 승인 대기 / 회사 목록 / 처리 완료.
// 승인 대기는 기존 ApprovalQueue.tsx(T03)를 **재사용**한다 — 새로 만들지 않는다.

import { ApprovalQueue } from "@/components/workspace-entry/ApprovalQueue";
import { OrgTable } from "@/components/platform/OrgTable";
import {
  ComingSoon,
  Panel,
  PlatformShell,
  platformStyles as styles,
} from "@/components/platform/PlatformShell";
import { requirePlatformAdmin } from "@/lib/platform/guard";
import { listOrgOverview, platformClient } from "@/lib/platform/server";
import { sortByRisk } from "@/lib/platform/metrics";
import { loadWorkspaceEntryContext } from "@/lib/workspace-entry/server";
import { count } from "@/lib/platform/format";
import Link from "next/link";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "pending", label: "승인 대기" },
  { key: "list", label: "회사 목록" },
  { key: "done", label: "처리 완료" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function parseTab(value: string | undefined): TabKey {
  return value === "pending" || value === "done" ? value : "list";
}

export default async function PlatformOrgsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const level = await requirePlatformAdmin();
  const tab = parseTab((await searchParams).tab);
  const client = await platformClient();

  // 내부 조직도 받아온 뒤 클라이언트 토글로 가린다 — 토글마다 왕복하지 않기 위함.
  const orgs = sortByRisk(await listOrgOverview(client, true));
  const entry = await loadWorkspaceEntryContext();
  const pending = entry.kind === "ready" ? entry.platformCreateRequests : [];

  return (
    <PlatformShell
      level={level}
      pathname="/platform/orgs"
      title="고객사 관리"
      description="회사 목록은 위험순(휴면 → 둔화 → 활발)으로 정렬됩니다."
    >
      <div className={styles.tabs}>
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/platform/orgs?tab=${t.key}`}
            className={`${styles.tab} ${t.key === tab ? styles.tabActive : ""}`}
            aria-current={t.key === tab ? "page" : undefined}
          >
            {t.label}
            {t.key === "pending" && pending.length > 0
              ? ` (${count(pending.length)})`
              : ""}
          </Link>
        ))}
      </div>

      {tab === "pending" ? (
        <Panel title="회사 만들기 승인 대기" note="플랫폼 운영 영역 · 고객 회사 권한은 생기지 않습니다">
          {entry.kind !== "ready" ? (
            <p className={styles.empty}>대기열을 불러오지 못했습니다 —</p>
          ) : (
            <ApprovalQueue mode="platform" requests={pending} />
          )}
        </Panel>
      ) : null}

      {tab === "list" ? (
        <Panel title="회사 목록" note="메타데이터만 표시 · 업무 데이터 미조회">
          <OrgTable rows={orgs} />
        </Panel>
      ) : null}

      {tab === "done" ? (
        <Panel title="처리 완료">
          <ComingSoon>
            처리 완료 이력은 승인/거절 감사 로그가 붙은 뒤 표시됩니다. (준비 중)
          </ComingSoon>
        </Panel>
      ) : null}
    </PlatformShell>
  );
}
