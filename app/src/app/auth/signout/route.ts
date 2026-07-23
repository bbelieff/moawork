import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { SESSION_COOKIE } from "@/lib/auth/session";

export async function POST(request: Request) {
  if (hasSupabaseEnv()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }

  const response = NextResponse.redirect(new URL("/login", request.url), {
    status: 303,
  });
  response.cookies.delete(SESSION_COOKIE.uid);
  response.cookies.delete(SESSION_COOKIE.org);
  response.cookies.delete(SESSION_COOKIE.as);
  return response;
}
