"use client";

// T07 · 고객사 목록 표 + 내부 조직 토글.
//
// 정렬은 **서버에서 위험순으로 이미 끝난 채** 들어온다(sortByRisk).
// 이 컴포넌트는 표시와 내부 조직 포함 토글만 담당한다 — 순서를 다시 만들지 않는다.

import Link from "next/link";
import { useMemo, useState } from "react";
import styles from "./platform.module.css";
import { HEALTH_LABEL, count, idleLabel } from "@/lib/platform/format";
import type { OrgListEntry } from "@/lib/platform/types";

const HEALTH_CLASS = {
  dormant: styles.badgeDormant,
  slowing: styles.badgeSlowing,
  active: styles.badgeActive,
} as const;

export function OrgTable({ rows }: { rows: OrgListEntry[] }) {
  // 내부 조직은 기본 꺼짐 — 지표를 흐리므로 운영자가 명시적으로 켤 때만 보인다.
  const [showInternal, setShowInternal] = useState(false);
  const visible = useMemo(
    () => (showInternal ? rows : rows.filter((r) => !r.isInternal)),
    [rows, showInternal],
  );
  const internalCount = useMemo(
    () => rows.filter((r) => r.isInternal).length,
    [rows],
  );

  return (
    <>
      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.375rem",
          marginBottom: "0.75rem",
          fontSize: "0.8125rem",
        }}
      >
        <input
          type="checkbox"
          checked={showInternal}
          onChange={(e) => setShowInternal(e.target.checked)}
        />
        내부 조직 표시
        {internalCount > 0 ? (
          <span className={`${styles.badge} ${styles.badgeMuted}`}>
            {count(internalCount)}곳
          </span>
        ) : null}
      </label>

      {visible.length === 0 ? (
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
                <th>요금제</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((o) => (
                <tr key={o.orgId}>
                  <td>
                    <Link href={`/platform/orgs/${o.orgId}`}>{o.name}</Link>
                    {o.isInternal ? (
                      <span
                        className={`${styles.badge} ${styles.badgeInternal}`}
                        style={{ marginLeft: "0.375rem" }}
                      >
                        내부
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <span className={`${styles.badge} ${HEALTH_CLASS[o.health]}`}>
                      {HEALTH_LABEL[o.health]}
                    </span>
                  </td>
                  <td>{idleLabel(o.idleDays)}</td>
                  <td className={styles.num}>{count(o.writes7d)}</td>
                  <td className={styles.num}>
                    {count(o.activeUsers7d)}/{count(o.memberCount)}
                  </td>
                  <td>{o.planTier || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
