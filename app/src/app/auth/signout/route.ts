import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { SESSION_COOKIE } from "@/lib/auth/session";

function signoutErrorResponse(request: Request) {
  const requestUrl = new URL(request.url);
  const fallback = new URL("/", requestUrl);
  const referer = request.headers.get("referer");
  let destination = fallback;
  if (referer) {
    const candidate = new URL(referer, requestUrl);
    if (candidate.origin === requestUrl.origin) destination = candidate;
  }
  destination.searchParams.set("error", "signout");
  return NextResponse.redirect(destination, { status: 303 });
}

export async function POST(request: Request) {
  if (hasSupabaseEnv()) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) return signoutErrorResponse(request);
    } catch {
      return signoutErrorResponse(request);
    }
  }

  const response = NextResponse.redirect(
    new URL("/login?reason=signed-out", request.url),
    { status: 303 },
  );
  response.cookies.delete(SESSION_COOKIE.uid);
  response.cookies.delete(SESSION_COOKIE.org);
  response.cookies.delete(SESSION_COOKIE.as);
  return response;
}
