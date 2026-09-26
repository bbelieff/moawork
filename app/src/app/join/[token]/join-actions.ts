"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  isInviteToken,
  parseInviteRedeem,
  workspacePath,
  type InviteRedeemOutcome,
  type JoinActionState,
} from "@/lib/org/invite-links";

/**
 * 초대 링크로 «들어간다».
 *
 * ★ 판정은 전부 148 의 redeem_org_invite 가 한다. 여기서는 부르고, 결과를 화면 말로 옮긴다.
 *   화면에서 버튼을 감추는 것으로는 아무것도 못 막는다 — 이 액션은 손으로도 부를 수 있다.
 */

export async function redeemInviteAction(
  _previous: JoinActionState,
  formData: FormData,
): Promise<JoinActionState> {
  const token = formData.get("token");
  // 모양이 아니면 DB 까지 안 간다. 경로에 아무 문자열이나 넣고 부르는 것을 여기서 자른다.
  if (!isInviteToken(token)) return { kind: "unusable" };

  let outcome: InviteRedeemOutcome;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("redeem_org_invite", { p_token: token });
    if (error) {
      // 42501 = 로그인 안 됨. 그 사람에게는 「링크가 죽었다」가 아니라 「로그인하세요」가 맞다.
      return error.code === "42501" ? { kind: "signed_out" } : { kind: "error" };
    }
    outcome = parseInviteRedeem(data);
  } catch {
    return { kind: "error" };
  }

  switch (outcome.kind) {
    case "joined":
    case "already":
      // ★ 들어갔으면 «회사 안» 으로 보낸다. 여기 남겨 두면 「들어왔는데 아무것도 없는」 화면이 된다.
      redirect(workspacePath(outcome.slug));
      break;
    case "needs_approval":
      return { kind: "needs_approval", orgName: outcome.orgName };
    default:
      return { kind: "unusable" };
  }
  // redirect 가 던지므로 여기 안 온다. 타입을 위해 둔다.
  return { kind: "error" };
}
