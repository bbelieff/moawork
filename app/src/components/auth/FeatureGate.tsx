import type { ReactNode } from "react";
import type { Ctx } from "@/lib/types";
import { EntitlementReadError, isEnabled } from "@/lib/entitlements";

// 엔타이틀먼트 게이트 UI — 기능이 꺼져 있으면(예: Phase 2 mod.notify/mod.hometax)
// 자식 대신 자물쇠 안내를 보여준다. ctx 를 받아 순수 렌더(세션 조회는 상위에서).
export async function FeatureGate({
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
  let enabled: boolean;
  try {
    enabled = await isEnabled(ctx, feature);
  } catch (error) {
    if (!(error instanceof EntitlementReadError)) throw error;
    return (
      <div
        role="alert"
        className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
      >
        워크스페이스 사용 권한을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.
      </div>
    );
  }
  if (enabled) return <>{children}</>;
  if (fallback !== undefined) return <>{fallback}</>;
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/40">
      🔒 {label ?? feature} — 현재 플랜에서 잠긴 기능입니다{" "}
      <span className="text-zinc-400">(Phase 2)</span>
    </div>
  );
}
