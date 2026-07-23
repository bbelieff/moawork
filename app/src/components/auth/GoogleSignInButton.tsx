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
        className="flex min-h-12 w-full items-center justify-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-opacity disabled:cursor-wait disabled:opacity-60"
        style={{
          background: "var(--mw-primary)",
          color: "var(--mw-on-accent)",
        }}
      >
        <span
          aria-hidden="true"
          className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs font-bold text-zinc-800"
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
