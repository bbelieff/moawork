import type { ReactNode } from "react";
import type { Ctx } from "@/lib/types";
import { isEnabled } from "@/lib/entitlements";

// 엔타이틀먼트 게이트 UI — 기능이 꺼져 있으면(예: Phase 2 mod.notify/mod.hometax)
// 자식 대신 자물쇠 안내를 보여준다. ctx 를 받아 순수 렌더(세션 조회는 상위에서).
export function FeatureGate({
  ctx,
  feature,
  label,
  children,
  fallback,
}: {
  ctx: Ctx;
  feature: string;
  label?: string;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  if (isEnabled(ctx, feature)) return <>{children}</>;
  if (fallback !== undefined) return <>{fallback}</>;
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/40">
      🔒 {label ?? feature} — 현재 플랜에서 잠긴 기능입니다{" "}
      <span className="text-zinc-400">(Phase 2)</span>
    </div>
  );
}
