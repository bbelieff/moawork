import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// 로그아웃: 세션을 파기하고 /login 으로 보낸다. POST 로만 처리(CSRF 안전).
export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // 303 See Other: POST 이후 GET 리다이렉트.
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
