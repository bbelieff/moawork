import { relativeRedirect } from "@/lib/auth/relative-redirect";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { SESSION_COOKIE } from "@/lib/auth/session";

function signoutErrorResponse(request: Request) {
  const requestUrl = new URL(request.url);
  const fallback = new URL("/", requestUrl);
  const referer = request.headers.get("referer");
  let destination = fallback;
  try {
  if (referer) {
    const candidate = new URL(referer, requestUrl);
    if (candidate.origin === requestUrl.origin) destination = candidate;
  }
  } catch { /* Invalid referer keeps the same local fallback. */ }
  destination.searchParams.set("error", "signout");
  try {
    return relativeRedirect(destination.pathname + destination.search + destination.hash, 303);
  } catch {
    return relativeRedirect("/?error=signout", 303);
  }
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

  const response = relativeRedirect("/login?reason=signed-out", 303);
  response.cookies.delete(SESSION_COOKIE.uid);
  response.cookies.delete(SESSION_COOKIE.org);
  response.cookies.delete(SESSION_COOKIE.as);
  return response;
}
