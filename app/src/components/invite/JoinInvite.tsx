"use client";

import { useActionState } from "react";
import {
  inviteRoleLabel,
  inviteScopeLabel,
  JOIN_IDLE,
  type InvitePeek,
  type JoinActionState,
} from "@/lib/org/invite-links";
import { redeemInviteAction } from "@/app/join/[token]/join-actions";

export type JoinInviteProps = {
  token: string;
  peek: InvitePeek;
  /** 서버가 판정한다. 화면은 이 값을 «표시» 할 뿐이다. */
  signedIn: boolean;
  /** 로그인하고 돌아올 자리. 서버가 만들어 넘긴다. */
  loginHref: string;
};

const CARD = "w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-zinc-50 p-6 dark:bg-zinc-900">
      <div className={CARD}>{children}</div>
    </main>
  );
}

/**
 * 링크를 받은 사람이 보는 «단 하나의» 화면.
 *
 * ★ 여기서 제일 중요한 것은 「무엇에 들어가는지 먼저 보여 주는 것」이다.
 *   지금까지는 회사 주소를 따로 알려 주고, 그 사람은 무엇에 신청하는지 모른 채 신청했다.
 */
export function JoinInvite({ token, peek, signedIn, loginHref }: JoinInviteProps) {
  const [state, submit, pending] = useActionState<JoinActionState, FormData>(redeemInviteAction, JOIN_IDLE);

  if (peek.kind === "unusable") {
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">이 초대 링크는 더 이상 쓸 수 없어요</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          기간이 지났거나, 받을 수 있는 인원을 다 채웠거나, 초대한 사람이 링크를 껐어요.
          초대해 준 사람에게 새 링크를 부탁해 주세요.
        </p>
      </Shell>
    );
  }

  /*
   * ★ 나갔던 사람. 「링크가 죽었다」고 하면 거짓말이다 — 링크는 멀쩡하고 그 사람이 못 들어가는 것이다.
   *   그리고 무엇을 해야 하는지 알려 줘야 한다.
   */
  if (state.kind === "needs_approval") {
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {state.orgName ? `「${state.orgName}」에는 링크로 다시 들어올 수 없어요` : "이 회사에는 링크로 다시 들어올 수 없어요"}
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          예전에 이 회사에 있었던 기록이 남아 있어요. 다시 들어오려면 회사 대표에게 직접 말씀해 주세요.
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">초대받았어요</p>
      <h1 className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">{peek.orgName}</h1>

      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-zinc-500 dark:text-zinc-400">맡을 자리</dt>
        <dd className="text-zinc-900 dark:text-zinc-100">{inviteRoleLabel(peek.role)}</dd>
        <dt className="text-zinc-500 dark:text-zinc-400">볼 수 있는 범위</dt>
        <dd className="text-zinc-900 dark:text-zinc-100">{inviteScopeLabel(peek.scope)}</dd>
      </dl>

      {signedIn ? (
        <form action={submit} className="mt-6">
          <input type="hidden" name="token" value={token} />
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {pending ? "들어가는 중…" : `${peek.orgName}에 들어가기`}
          </button>
        </form>
      ) : (
        <>
          <a
            href={loginHref}
            className="mt-6 block w-full rounded-xl bg-zinc-900 px-4 py-2.5 text-center text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            구글로 로그인하고 들어가기
          </a>
          <p className="mt-2 text-center text-xs text-zinc-500 dark:text-zinc-400">
            로그인하면 바로 이 화면으로 돌아와요. 따로 신청하거나 승인을 기다리지 않아도 돼요.
          </p>
        </>
      )}

      {state.kind === "unusable" ? (
        <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">
          이 초대 링크는 더 이상 쓸 수 없어요. 초대해 준 사람에게 새 링크를 부탁해 주세요.
        </p>
      ) : null}
      {state.kind === "signed_out" ? (
        <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">
          로그인이 풀렸어요. 다시 로그인한 뒤 눌러 주세요.
        </p>
      ) : null}
      {state.kind === "error" ? (
        <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">
          지금은 들어갈 수 없어요. 잠시 뒤 다시 눌러 주세요.
        </p>
      ) : null}
    </Shell>
  );
}
