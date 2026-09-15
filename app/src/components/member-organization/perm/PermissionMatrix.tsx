import type { ReactElement, ReactNode } from "react";
import { PERM_MATRIX, ROLES, ROLE_DATA_SCOPE_LABEL, ROLE_LABEL, type Role } from "@/lib/perm/matrix";
import type { PermMatrixSnapshot } from "@/lib/perm/server";
import { toggleRolePermissionAction } from "./actions";

/*
 * 2026-08-26 — 목업 CSS 클래스를 걷어내고 앱의 스타일로 다시 썼다.
 *
 * 무엇이 문제였나 (운영 실측)
 *   이 파일은 `pane` · `ptit` · `tnode` · `prow` · `tg` 같은 **목업 스타일시트의 클래스**를
 *   쓰고 있었다. 그런데 그 클래스는 앱 CSS 어디에도 없다(전수 검색 0건).
 *   결과:
 *     · 역할 목록이 «소유자0관리자0팀장0멤버0» 한 덩어리로 붙어 보였다
 *     · 권한 목록이 카드도 테두리도 없이 맨 텍스트로 흘렀다
 *     · ★ 켜기/끄기 **토글이 아예 안 보였다** — 이 화면의 핵심 조작이 없는 셈이었다
 *   즉 «만들어졌지만 화면에 닿지 않은» 부품이었다. 옆의 회사 로고·구성원 카드는
 *   Tailwind + `--mw-*` 토큰으로 제대로 그려지고 있어서 이 구역만 유독 헐벗어 보였다.
 *
 * 계약(props·서버 액션·aria)은 그대로 두고 **마크업만** 바꿨다.
 */

export type PermissionMatrixAccess =
  | { kind: "allowed"; snapshot: PermMatrixSnapshot }
  | { kind: "denied"; reason: "permission" }
  | { kind: "denied"; reason: "unavailable" };

export type PermissionMatrixProps = {
  orgId: string;
  /** 지금 화면에 펼쳐 보는 역할 탭. 라우팅은 호출부(리스 밖) 소관 — 여기선 ?role= 상대링크만 낸다. */
  activeRole: Role;
  /** 이 화면을 보는 사람의 역할. 대표만 토글이 실제로 동작한다(RPC 가 강제). */
  viewerRole: Role;
  access: PermissionMatrixAccess;
  /** 역할별 보유 인원 수 — 없으면 0 으로 그린다. */
  roleMemberCounts?: Partial<Record<Role, number>>;
  /** 토글 후 재검증할 경로. 아직 화면에 연결되지 않았으면 생략 가능. */
  revalidatePath?: string;
};

const CARD = "rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950";

function AccessDenied({ children }: { children: ReactNode }): ReactElement {
  return <section role="alert" className={`${CARD} p-4`}>{children}</section>;
}

/** 켜짐/꺼짐이 «한눈에» 보이는 스위치. 예전에는 클래스가 없어 아무것도 안 보였다. */
function Switch({ on, disabled }: { on: boolean; disabled: boolean }): ReactElement {
  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex h-5 w-9 flex-none rounded-full transition ${
        on ? "bg-violet-600" : "bg-zinc-300 dark:bg-zinc-700"
      } ${disabled ? "opacity-50" : ""}`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`}
      />
    </span>
  );
}

export function PermissionMatrix(props: PermissionMatrixProps): ReactElement {
  const { orgId, activeRole, viewerRole, access, roleMemberCounts = {}, revalidatePath } = props;

  if (access.kind === "denied" && access.reason === "permission") {
    return (
      <AccessDenied>
        <h2 className="font-semibold">권한 화면을 볼 수 없어요</h2>
        <p className="mt-1 text-sm text-zinc-500">이 화면은 대표와 관리자만 열 수 있어요.</p>
      </AccessDenied>
    );
  }

  if (access.kind === "denied" && access.reason === "unavailable") {
    return (
      <AccessDenied>
        <h2 className="font-semibold">권한 정보를 불러오지 못했어요</h2>
        <p className="mt-1 text-sm text-zinc-500">잠시 후 다시 시도해 주세요.</p>
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
    // 좁은 화면에서는 위아래로 쌓는다 — 230px 고정 두 칸은 375px 에서 표가 밀린다.
    <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[minmax(0,200px)_minmax(0,1fr)]">
      <nav aria-label="역할" className={`${CARD} p-3`}>
        <h2 className="px-1 pb-2 text-sm font-semibold">역할</h2>
        <div className="flex flex-col gap-0.5">
          {ROLES.map((role) => {
            const active = role === activeRole;
            return (
              <a
                key={role}
                href={`?role=${role}`}
                data-role={role}
                aria-current={active ? "true" : undefined}
                className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm transition ${
                  active
                    ? "bg-violet-50 font-semibold text-violet-800 dark:bg-violet-950 dark:text-violet-200"
                    : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900"
                }`}
              >
                <span>{ROLE_LABEL[role]}</span>
                <span className="tabular-nums text-xs text-zinc-500">{roleMemberCounts[role] ?? 0}</span>
              </a>
            );
          })}
        </div>
        <p className="mt-3 border-t border-zinc-100 px-1 pt-3 text-[11px] leading-relaxed text-zinc-500 dark:border-zinc-900">
          역할로 묶어 주고, 사람마다 예외를 더합니다.
          <br />
          <b className="text-zinc-700 dark:text-zinc-300">차단이 허용보다 셉니다.</b>
        </p>
      </nav>

      <section aria-label={`${ROLE_LABEL[activeRole]} 권한`} className={`${CARD} p-4`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-100 pb-3 dark:border-zinc-900">
          <h2 className="text-sm font-semibold">{ROLE_LABEL[activeRole]}</h2>
          <span className="text-xs text-zinc-500">
            이 역할 {roleMemberCounts[activeRole] ?? 0}명 · 데이터 범위 {ROLE_DATA_SCOPE_LABEL[activeRole]}
          </span>
        </div>

        {!canEdit ? (
          <p className="mt-3 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
            대표만 이 화면에서 토글을 바꿀 수 있어요. 보기 전용이에요.
          </p>
        ) : null}

        {PERM_MATRIX.map((group) => (
          <div key={group.group} className="mt-5">
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="text-xs font-semibold text-zinc-500">{group.group}</h3>
              {group.group === "위험" ? (
                <span className="text-[11px] text-rose-600 dark:text-rose-400">되돌리기 어렵거나 비용·유출이 따릅니다</span>
              ) : null}
            </div>
            <ul className="mt-1.5 flex flex-col divide-y divide-zinc-100 dark:divide-zinc-900">
              {group.items.map((item) => {
                const row = snapshot.matrix.find((m) => m.scopeKey === item.scopeKey);
                const currentAllowed = row ? row.allowed[activeRole] : item.defaultAllowed[ROLES.indexOf(activeRole)];
                const roleImmutable = activeRole === "owner";
                const toggleDisabled = !canEdit || roleImmutable;
                return (
                  <li
                    key={item.scopeKey}
                    data-scope-key={item.scopeKey}
                    className={`flex items-center gap-3 py-2.5 ${item.danger ? "border-l-2 border-l-rose-400 pl-2" : ""}`}
                  >
                    <div className="min-w-0 flex-1">
                      <b className="text-[13px] font-semibold">{item.label}</b>
                      {item.description ? (
                        <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">{item.description}</p>
                      ) : null}
                      {(exceptionCountByScope.get(item.scopeKey) ?? 0) > 0 ? (
                        <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-400">
                          개인 예외 {exceptionCountByScope.get(item.scopeKey)}건 적용 중
                        </p>
                      ) : null}
                    </div>
                    <form action={toggleRolePermissionAction}>
                      <input type="hidden" name="orgId" value={orgId} />
                      <input type="hidden" name="role" value={activeRole} />
                      <input type="hidden" name="scopeKey" value={item.scopeKey} />
                      <input type="hidden" name="nextAllowed" value={String(!currentAllowed)} />
                      {revalidatePath ? <input type="hidden" name="path" value={revalidatePath} /> : null}
                      <button
                        type="submit"
                        disabled={toggleDisabled}
                        aria-pressed={currentAllowed}
                        aria-label={`${item.label} ${currentAllowed ? "켜짐" : "꺼짐"}${roleImmutable ? " · 대표 권한은 끌 수 없어요" : ""}`}
                        title={roleImmutable ? "대표 권한은 끌 수 없어요" : undefined}
                        className="flex items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 disabled:cursor-not-allowed"
                      >
                        <Switch on={currentAllowed} disabled={toggleDisabled} />
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        <p className="mt-5 border-t border-zinc-100 pt-3 text-[11px] leading-relaxed text-zinc-500 dark:border-zinc-900">
          사람마다 예외를 줄 수 있습니다. 충돌하면 <b className="text-zinc-700 dark:text-zinc-300">차단이 허용을 이깁니다.</b>
          <br />
          <b className="text-zinc-700 dark:text-zinc-300">위험 구역 5개는 반드시 기록을 남깁니다</b> — 특히 CSV 내보내기는 고객 정보가 파일로 나가는 경로입니다.
        </p>
      </section>
    </div>
  );
}
