"use client";

import Image from "next/image";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { safeNextPath } from "@/lib/auth/oauth";
import { LOGIN_ATTEMPT_MARKER } from "@/lib/analytics/events";
import { track } from "@/lib/analytics/useTrack";

export function GoogleSignInButton({ nextPath = "/" }: { nextPath?: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setPending(true);
    setError(null);

    try {
      window.sessionStorage.setItem(LOGIN_ATTEMPT_MARKER, "1");
    } catch {
      // Analytics state must never block authentication.
    }

    try {
      const callback = new URL("/auth/callback", window.location.origin);
      callback.searchParams.set("next", safeNextPath(nextPath));
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: callback.toString() },
      });
      if (authError) throw authError;
    } catch {
      try {
        window.sessionStorage.removeItem(LOGIN_ATTEMPT_MARKER);
      } catch {
        // Analytics state must never block authentication.
      }
      track("login_result", { outcome: "failure", reason: "oauth_start" });
      setPending(false);
      setError("Google 로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={signIn}
        disabled={pending}
        aria-busy={pending}
        className="flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold shadow-sm transition-[border-color,box-shadow,opacity] hover:border-mw-primary hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mw-primary disabled:cursor-wait disabled:opacity-60"
        style={{
          borderColor: "color-mix(in srgb, var(--mw-fg) 50%, var(--mw-card))",
          background: "var(--mw-card)",
          color: "var(--mw-fg)",
        }}
      >
        <Image
          src="/brand/google-g.svg"
          alt=""
          width={20}
          height={20}
          aria-hidden="true"
        />
        <span aria-live="polite">
          {pending ? "Google로 이동 중…" : "Google로 계속하기"}
        </span>
      </button>
      {error ? (
        <p role="alert" className="text-sm text-mw-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
