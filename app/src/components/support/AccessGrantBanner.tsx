"use client";

/**
 * 위임 중 고정 배너 — T08.
 * `🔓 운영자가 보고 있어요 · 남은 시간 1시간 42분 · [지금 중단]`
 *
 * 위임이 살아 있는 동안 **항상** 보인다. 남은 시간은 1분 간격으로 갱신하고,
 * 0이 되면 스스로 사라지며 서버 상태를 다시 읽어 만료 기록이 남게 한다.
 */

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AccessGrant } from "@/lib/support/types";
import { formatRemaining, grantRemainingMs } from "@/lib/support/types";
import styles from "./support.module.css";

export function AccessGrantBanner({ grant }: { grant: AccessGrant }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // 남은 시간은 **파생값**이다 — 시계만 30초마다 밀고 렌더에서 계산한다.
  // (상태를 effect 안에서 동기화하면 cascading render 가 된다)
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const remaining = grantRemainingMs(grant, new Date(nowMs));

  // 만료 순간 서버를 다시 읽어 만료 기록(소식창·감사로그)을 확정시킨다.
  useEffect(() => {
    if (remaining <= 0) router.refresh();
  }, [remaining, router]);

  if (remaining <= 0) return null;

  const stop = () => {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/support/grants/${grant.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "중단하지 못했습니다");
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className={styles.banner} role="status" aria-live="polite">
      <span>🔓 운영자가 보고 있어요</span>
      <span aria-hidden>·</span>
      <span>남은 시간 {formatRemaining(remaining)}</span>
      {grant.mode === "write" ? <span>· 보기+고치기</span> : null}
      <button
        type="button"
        className={styles.bannerStop}
        onClick={stop}
        disabled={pending}
      >
        {pending ? "중단 중…" : "지금 중단"}
      </button>
      {error ? <span className={styles.error}>{error}</span> : null}
    </div>
  );
}
