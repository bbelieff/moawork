import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// OAuth 콜백: 구글 동의 후 Supabase 가 ?code 를 붙여 이 경로로 돌려보낸다.
// 1) code 를 세션으로 교환(쿠키 설정)하고
// 2) public.users 프로필 행을 upsert 한다.
//    (001_schema_v1.sql 은 users 테이블은 두되 auth.users→users 자동생성 트리거가 없다.
//     org_members.user_id / deals.assigned_to 등 FK 가 users.id 를 참조하므로 로그인 시 보강.)
// 3) 원래 목적지(next)로 리다이렉트한다.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const meta = user.user_metadata ?? {};
        await supabase.from("users").upsert(
          {
            id: user.id,
            email: user.email ?? null,
            name: meta.full_name ?? meta.name ?? null,
            avatar_url: meta.avatar_url ?? meta.picture ?? null,
          },
          { onConflict: "id" },
        );
      }
      // 오픈 리다이렉트 방지: 앱 내부 경로로만 이동.
      const dest = next.startsWith("/") ? next : "/";
      return NextResponse.redirect(`${origin}${dest}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
