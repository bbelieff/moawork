"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { safeNextPath } from "@/lib/auth/oauth";

export function GoogleSignInButton({ nextPath = "/" }: { nextPath?: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setPending(true);
    setError(null);

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
        className="flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold shadow-sm transition-[transform,border-color,box-shadow,opacity] hover:-translate-y-px hover:border-mw-primary hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mw-primary disabled:cursor-wait disabled:opacity-60 disabled:hover:translate-y-0"
        style={{
          borderColor: "var(--mw-line)",
          background: "var(--mw-card)",
          color: "var(--mw-fg)",
        }}
      >
        <span
          aria-hidden="true"
          className="flex h-6 w-6 items-center justify-center rounded-full bg-mw-bg text-sm font-black text-mw-record"
        >
          G
        </span>
        {pending ? "Google로 이동 중…" : "Google로 계속하기"}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
