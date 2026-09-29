import { JoinInvite } from "@/components/invite/JoinInvite";
import { createClient } from "@/lib/supabase/server";
import { inviteJoinPath, isInviteToken, parseInvitePeek, type InvitePeek } from "@/lib/org/invite-links";

/**
 * 「사람 부르기」 링크를 받은 사람이 보는 화면.
 *
 * ★ (app) 바깥에 둔다 — 아직 «어느 회사 사람도 아닌» 사람이 여는 화면이기 때문이다.
 *   (app) 안에 두면 사이드바·회사 문맥이 필요해지고, 그것들은 소속이 있어야 만들어진다.
 *
 * ★ 로그인 «전» 에도 무엇에 들어가는지 보여 준다. 그게 이 기능의 요점이다 —
 *   지금까지는 회사 주소를 따로 알려 주고, 그 사람은 무엇에 신청하는지 모른 채 신청했다.
 */
export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // 모양이 아니면 DB 까지 안 간다. 「없는 링크」와 같은 말을 한다.
  if (!isInviteToken(token)) {
    return <JoinInvite token="" peek={{ kind: "unusable" }} signedIn={false} loginHref="/login" />;
  }

  const supabase = await createClient();

  /*
   * 미리보기와 로그인 여부를 «같은 물결» 로 읽는다. 뒤에 붙이면 왕복이 는다.
   * peek 은 anon 에게도 열려 있다(147) — 로그인 전에 보여 줘야 하기 때문이다.
   */
  const [peekResult, userResult] = await Promise.all([
    supabase.rpc("peek_org_invite", { p_token: token }),
    supabase.auth.getUser(),
  ]);

  const peek: InvitePeek = peekResult.error ? { kind: "unusable" } : parseInvitePeek(peekResult.data);
  const signedIn = !userResult.error && Boolean(userResult.data?.user);

  // ★ 로그인하고 «이 화면으로» 돌아오게 한다. 안 그러면 초대받은 줄도 모르고 신청 화면에 떨어진다.
  const loginHref = `/login?next=${encodeURIComponent(inviteJoinPath(token))}`;

  return <JoinInvite token={token} peek={peek} signedIn={signedIn} loginHref={loginHref} />;
}
