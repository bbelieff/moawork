"use client";

import { useActionState, useState } from "react";
import {
  INVITE_ROLES,
  INVITE_SCOPES,
  inviteJoinPath,
  inviteRoleLabel,
  inviteScopeLabel,
  INVITE_IDLE,
  type InviteActionState,
} from "@/lib/org/invite-links";
import type { InviteLinkList, InviteLinkRow } from "@/lib/org/invite-links-server";
import {
  createInviteLinkAction,
  revokeInviteLinkAction,
} from "@/app/(app)/settings/members/invite-actions";

export type InviteLinkCardProps = {
  list: InviteLinkList;
  /** 서버가 판정한 값만 받는다. 화면은 이 값을 «표시» 할 뿐 권한을 만들지 않는다. */
  canManage: boolean;
};

/** 브라우저에서만 안다 — 서버는 사용자가 어떤 주소로 접속했는지 모른다. */
function fullLink(token: string): string {
  if (typeof window === "undefined") return inviteJoinPath(token);
  return `${window.location.origin}${inviteJoinPath(token)}`;
}

function whenLabel(row: InviteLinkRow): string {
  const parts: string[] = [];
  if (row.expiresAt) {
    const date = new Date(row.expiresAt);
    parts.push(Number.isNaN(date.getTime()) ? "기간 있음" : `${date.toLocaleDateString("ko-KR")}까지`);
  } else {
    parts.push("기간 없음");
  }
  parts.push(row.maxUses === null ? `${row.usedCount}명 들어옴` : `${row.usedCount}/${row.maxUses}명`);
  return parts.join(" · ");
}

function CopyButton({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(fullLink(token));
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
      className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
    >
      {copied ? "복사했어요" : "링크 복사"}
    </button>
  );
}

/**
 * 「사람 부르기」 — 링크를 만들고, 누가 들어왔는지 보고, 끈다 (#722).
 *
 * ★ 이 링크는 «곧 허가» 다. 승인 단계가 없다(총괄 결정 2026-09-07).
 *   그래서 화면이 그 사실을 숨기지 않는다 — 「링크를 가진 사람은 바로 들어와요」라고 적는다.
 */
export function InviteLinkCard({ list, canManage }: InviteLinkCardProps) {
  const [createState, create, creating] = useActionState<InviteActionState, FormData>(createInviteLinkAction, INVITE_IDLE);
  const [revokeState, revoke] = useActionState<InviteActionState, FormData>(revokeInviteLinkAction, INVITE_IDLE);
  const [limitMode, setLimitMode] = useState<"days" | "uses">("days");

  if (!canManage) return null;

  return (
    <section className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
      <header>
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">사람 부르기</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          링크를 만들어 보내면 그 사람이 구글 로그인만 하고 바로 들어와요. 따로 승인하지 않아도 돼요.
        </p>
      </header>

      <form action={create} className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          맡을 자리
          <select name="role" defaultValue="member" className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
            {INVITE_ROLES.map((role) => (
              <option key={role} value={role}>{inviteRoleLabel(role)}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          볼 수 있는 범위
          <select name="scope" defaultValue="assigned" className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
            {INVITE_SCOPES.map((scope) => (
              <option key={scope} value={scope}>{inviteScopeLabel(scope)}</option>
            ))}
          </select>
        </label>

        {/*
          ★ 기한과 횟수 중 «하나는» 반드시 정한다 — 둘 다 비우면 끄기 전까지 영원히 사는 열쇠가 된다.
            그래서 화면에서 «둘 다 비우는 모양» 자체를 안 만든다. 서버(148)도 같은 것을 막는다.
        */}
        <div className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          언제까지 쓸 수 있나
          <div className="flex items-center gap-2">
            <select
              value={limitMode}
              onChange={(event) => setLimitMode(event.target.value as "days" | "uses")}
              className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            >
              <option value="days">기간으로</option>
              <option value="uses">인원으로</option>
            </select>
            {limitMode === "days" ? (
              <>
                <input key="days" name="days" type="number" min={1} max={365} defaultValue={7} className="w-20 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" />
                <span className="text-sm text-zinc-600 dark:text-zinc-300">일 동안</span>
              </>
            ) : (
              <>
                <input key="uses" name="maxUses" type="number" min={1} max={1000} defaultValue={1} className="w-20 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" />
                <span className="text-sm text-zinc-600 dark:text-zinc-300">명까지</span>
              </>
            )}
          </div>
        </div>

        <button type="submit" disabled={creating} className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
          {creating ? "만드는 중…" : "초대 링크 만들기"}
        </button>
      </form>

      {createState.kind === "created" ? (
        <p className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-zinc-100 px-3 py-2 text-sm dark:bg-zinc-900">
          <span className="text-zinc-700 dark:text-zinc-200">링크를 만들었어요.</span>
          <code className="truncate text-xs text-zinc-500 dark:text-zinc-400">{inviteJoinPath(createState.token)}</code>
          <CopyButton token={createState.token} />
        </p>
      ) : null}
      {createState.kind === "error" ? (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{createState.message}</p>
      ) : null}
      {revokeState.kind === "error" ? (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{revokeState.message}</p>
      ) : null}

      <div className="mt-5">
        {list.kind === "unavailable" ? (
          // ★ 빈 목록을 그리지 않는다 — 「만든 링크가 없다」는 거짓말이 되고, 살아있는 링크를 못 끄게 된다.
          <p role="alert" className="text-sm text-zinc-600 dark:text-zinc-300">
            만들어 둔 초대 링크를 불러오지 못했어요. 잠시 뒤 다시 확인해 주세요.
          </p>
        ) : list.links.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">아직 만든 초대 링크가 없어요.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {list.links.map((row) => (
              <li key={row.token} className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
                <span className={row.usable ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : "rounded-full bg-zinc-200 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"}>
                  {row.usable ? "쓸 수 있음" : row.revokedAt ? "꺼짐" : "만료"}
                </span>
                <span className="text-zinc-900 dark:text-zinc-100">{inviteRoleLabel(row.role)}</span>
                <span className="text-zinc-500 dark:text-zinc-400">{inviteScopeLabel(row.scope)}</span>
                <span className="text-zinc-500 dark:text-zinc-400">{whenLabel(row)}</span>
                <span className="ml-auto flex items-center gap-2">
                  {row.usable ? <CopyButton token={row.token} /> : null}
                  {row.revokedAt ? null : (
                    <form action={revoke}>
                      <input type="hidden" name="token" value={row.token} />
                      <button type="submit" className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
                        끄기
                      </button>
                    </form>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
