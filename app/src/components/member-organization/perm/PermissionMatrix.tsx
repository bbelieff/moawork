import type { ReactElement, ReactNode } from "react";
import { PERM_MATRIX, ROLES, ROLE_DATA_SCOPE_LABEL, ROLE_LABEL, type Role } from "@/lib/perm/matrix";
import type { PermMatrixSnapshot } from "@/lib/perm/server";
import { toggleRolePermissionAction } from "./actions";

export type PermissionMatrixAccess =
  | { kind: "allowed"; snapshot: PermMatrixSnapshot }
  | { kind: "denied"; reason: "permission" }
  | { kind: "denied"; reason: "unavailable" };

export type PermissionMatrixProps = {
  orgId: string;
  /** 지금 화면에 펼쳐 보는 역할 탭. 라우팅은 호출부(리스 밖) 소관 — 여기선 ?role= 상대링크만 낸다. */
  activeRole: Role;
  /** 이 화면을 보는 사람의 역할. 소유자만 토글이 실제로 동작한다(RPC 가 강제). */
  viewerRole: Role;
  access: PermissionMatrixAccess;
  /** 역할별 보유 인원 수 — 없으면 표시하지 않는다. */
  roleMemberCounts?: Partial<Record<Role, number>>;
  /** 토글 후 재검증할 경로. 아직 화면에 연결되지 않았으면 생략 가능. */
  revalidatePath?: string;
};

function AccessDenied({ children }: { children: ReactNode }): ReactElement {
  return (
    <section role="alert" className="rounded-xl border p-4" style={{ background: "var(--mw-card)", borderColor: "var(--mw-line)" }}>
      {children}
    </section>
  );
}

export function PermissionMatrix(props: PermissionMatrixProps): ReactElement {
  const { orgId, activeRole, viewerRole, access, roleMemberCounts = {}, revalidatePath } = props;

  if (access.kind === "denied" && access.reason === "permission") {
    return (
      <AccessDenied>
        <h2 className="font-semibold">권한 화면을 볼 수 없어요</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--mw-sub)" }}>
          이 화면은 소유자·관리자만 열 수 있습니다.
        </p>
      </AccessDenied>
    );
  }

  if (access.kind === "denied" && access.reason === "unavailable") {
    return (
      <AccessDenied>
        <h2 className="font-semibold">권한 정보를 불러오지 못했어요</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--mw-sub)" }}>
          잠시 후 다시 시도해 주세요.
        </p>
      </AccessDenied>
    );
  }

  const { snapshot } = access;
  const canEdit = viewerRole === "owner";
  const exceptionCountByScope = new Map<string, number>();
  for (const e of snapshot.exceptions) {
    exceptionCountByScope.set(e.scopeKey, (exceptionCountByScope.get(e.scopeKey) ?? 0) + 1);
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "230px 1fr", gap: "var(--sp3, 12px)", alignItems: "start" }}>
      <nav aria-label="역할" className="pane">
        <div className="ptit">역할</div>
        <div className="tree">
          {ROLES.map((r) => (
            <a
              key={r}
              href={`?role=${r}`}
              data-role={r}
              aria-current={r === activeRole ? "true" : undefined}
              className={`tnode${r === activeRole ? " on" : ""}`}
            >
              <span className="n">{ROLE_LABEL[r]}</span>
              <span className="c">{roleMemberCounts[r] ?? 0}</span>
            </a>
          ))}
        </div>
        <p className="mute" style={{ fontSize: 11.5, lineHeight: 1.8, padding: "0 var(--sp3, 12px)" }}>
          역할로 묶어 주고, 사람마다 예외를 더합니다.
          <br />
          <b>차단이 허용보다 셉니다.</b>
        </p>
      </nav>

      <section aria-label={`${ROLE_LABEL[activeRole]} 권한`} className="pane">
        <div className="ptit">
          {ROLE_LABEL[activeRole]}{" "}
          <span className="r">
            이 역할 {roleMemberCounts[activeRole] ?? 0}명 · 데이터 범위 {ROLE_DATA_SCOPE_LABEL[activeRole]}
          </span>
        </div>

        {!canEdit && (
          <p className="mute" style={{ fontSize: 11.5, padding: "4px var(--sp3, 12px)" }}>
            소유자만 이 화면에서 토글을 바꿀 수 있습니다. 보기 전용입니다.
          </p>
        )}

        {PERM_MATRIX.map((group) => (
          <div key={group.group}>
            <div className="rgrp" style={{ marginTop: 18 }}>
              {group.group}
              {group.group === "위험" && (
                <span style={{ color: "var(--mw-error)", fontSize: 11 }}>되돌리기 어렵거나 비용·유출이 따릅니다</span>
              )}
            </div>
            {group.items.map((item) => {
              const row = snapshot.matrix.find((m) => m.scopeKey === item.scopeKey);
              const currentAllowed = row ? row.allowed[activeRole] : item.defaultAllowed[ROLES.indexOf(activeRole)];
              const roleImmutable = activeRole === "owner";
              const toggleDisabled = !canEdit || roleImmutable;
              return (
                <div key={item.scopeKey} className={`prow${item.danger ? " danger" : ""}`} data-scope-key={item.scopeKey}>
                  <div style={{ flex: 1 }}>
                    <b style={{ fontSize: 12.5, fontWeight: 600 }}>{item.label}</b>
                    {item.description && (
                      <div className="mute" style={{ fontSize: 11.5, marginTop: 1, lineHeight: 1.6 }}>
                        {item.description}
                      </div>
                    )}
                    {(exceptionCountByScope.get(item.scopeKey) ?? 0) > 0 && (
                      <div className="mute" style={{ fontSize: 11, marginTop: 2 }}>
                        개인 예외 {exceptionCountByScope.get(item.scopeKey)}건 적용 중
                      </div>
                    )}
                  </div>
                  <form action={toggleRolePermissionAction}>
                    <input type="hidden" name="orgId" value={orgId} />
                    <input type="hidden" name="role" value={activeRole} />
                    <input type="hidden" name="scopeKey" value={item.scopeKey} />
                    <input type="hidden" name="nextAllowed" value={String(!currentAllowed)} />
                    {revalidatePath && <input type="hidden" name="path" value={revalidatePath} />}
                    <button
                      type="submit"
                      disabled={toggleDisabled}
                      aria-pressed={currentAllowed}
                      aria-label={`${item.label} ${currentAllowed ? "켜짐" : "꺼짐"}${roleImmutable ? " · 소유자 권한은 끌 수 없습니다" : ""}`}
                      title={roleImmutable ? "소유자 권한은 끌 수 없습니다" : undefined}
                      className={`tg${currentAllowed ? "" : " off"}`}
                    >
                      <i />
                    </button>
                  </form>
                </div>
              );
            })}
          </div>
        ))}

        <p className="mute" style={{ fontSize: 11.5, marginTop: 18 }}>
          사람마다 예외를 줄 수 있습니다. 충돌하면 <b>차단이 허용을 이깁니다.</b>
          <br />
          <b>위험 구역 5개는 반드시 기록을 남깁니다</b> — 특히 CSV 내보내기는 고객 정보가 파일로 나가는 경로입니다.
        </p>
      </section>
    </div>
  );
}
