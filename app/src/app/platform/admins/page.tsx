// T07 · /platform/admins — 어드민 관리.
//
// 조회는 3등급 동일, **편집은 super 만**(014 platform_set_admin 이 서버에서 강제).
// 목록은 SECURITY DEFINER RPC(platform_admin_list) 경유 — app_admins 직접 select 금지.
// 회수된 관리자도 감사 목적으로 남겨 표시한다.

import {
  Panel,
  PlatformShell,
  platformStyles as styles,
} from "@/components/platform/PlatformShell";
import { requirePlatformAdmin } from "@/lib/platform/guard";
import { listAdmins, platformClient } from "@/lib/platform/server";
import { can, maskEmail } from "@/lib/platform/access";
import { count, day } from "@/lib/platform/format";

export const dynamic = "force-dynamic";

const LEVEL_NOTE: Record<string, string> = {
  super: "관리자 편집 포함 전체 실행",
  operator: "운영 실행(승인·토글·내보내기)",
  viewer: "조회만",
};

/** 서버에서 강제되는 안전장치 — 화면에도 그대로 적어 운영자가 예측 가능하게 한다. */
const SAFEGUARDS = [
  "관리자 편집은 super 등급만 가능합니다.",
  "이메일 형식을 서버에서 검증합니다.",
  "자기 자신의 등급은 낮추거나 회수할 수 없습니다(락아웃 방지).",
  "마지막 super 관리자는 회수·강등할 수 없습니다.",
  "회수는 행을 지우지 않고 revoked_at 을 남깁니다(감사 보존).",
  "모든 권한 변경은 감사 로그에 기록됩니다.",
];

export default async function PlatformAdminsPage() {
  const level = await requirePlatformAdmin();
  const admins = await listAdmins(await platformClient());
  const canManage = can(level, "manageAdmins");

  const active = admins.filter((a) => !a.revokedAt);
  const revoked = admins.filter((a) => a.revokedAt);

  return (
    <PlatformShell
      level={level}
      pathname="/platform/admins"
      title="어드민 관리"
      description="조회는 전 등급 동일하고, 등급은 실행 권한만 가릅니다."
    >
      {!canManage ? (
        <p className={styles.notice} style={{ marginBottom: "1rem" }}>
          현재 등급({level})은 조회만 가능합니다. 등급 편집은 super 관리자에게 요청하세요.
        </p>
      ) : null}

      <Panel title={`활성 운영자 (${count(active.length)})`}>
        {active.length === 0 ? (
          <p className={styles.empty}>표시할 운영자가 없습니다 —</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>이메일</th>
                  <th>등급</th>
                  <th>권한 범위</th>
                  <th>발급자</th>
                  <th>최근 접속</th>
                </tr>
              </thead>
              <tbody>
                {active.map((a) => (
                  <tr key={a.email}>
                    {/* 어깨너머 방지 — 목록에서는 마스킹된 이메일만 보인다. */}
                    <td>{maskEmail(a.email)}</td>
                    <td>
                      <span className={`${styles.badge} ${styles.badgeInternal}`}>
                        {a.level}
                      </span>
                    </td>
                    <td>{LEVEL_NOTE[a.level] ?? "—"}</td>
                    <td>{a.addedBy ? maskEmail(a.addedBy) : "—"}</td>
                    <td>{day(a.lastSeenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {revoked.length > 0 ? (
        <Panel title={`회수됨 (${count(revoked.length)})`} note="감사 목적으로 남깁니다">
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>이메일</th>
                  <th>마지막 등급</th>
                  <th>회수일</th>
                </tr>
              </thead>
              <tbody>
                {revoked.map((a) => (
                  <tr key={a.email}>
                    <td>{maskEmail(a.email)}</td>
                    <td>
                      <span className={`${styles.badge} ${styles.badgeMuted}`}>
                        {a.level}
                      </span>
                    </td>
                    <td>{day(a.revokedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}

      <Panel title="안전장치" note="전부 서버(RPC)에서 강제됩니다">
        <ol style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.875rem" }}>
          {SAFEGUARDS.map((s) => (
            <li key={s} style={{ marginBottom: "0.25rem" }}>
              {s}
            </li>
          ))}
        </ol>
      </Panel>
    </PlatformShell>
  );
}
