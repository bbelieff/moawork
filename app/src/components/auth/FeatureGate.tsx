import type { ReactNode } from "react";
import type { Ctx } from "@/lib/types";
import { isEnabled } from "@/lib/entitlements";
import { FeatureLockNotice } from "./FeatureLockNotice";

// 엔타이틀먼트 게이트 UI — 기능이 꺼져 있으면(예: Phase 2 mod.notify/mod.hometax)
// 자식 대신 자물쇠 안내를 보여준다. ctx 를 받아 순수 렌더(세션 조회는 상위에서).
//
// ⚠ 판정이 `getRepo()`(= 항상 LocalRepo 인메모리 시드) 라서 **로컬 개발 전용**이다.
//    프로덕션의 실 org UUID 는 그 스토어에 없어 언제나 잠김으로 떨어진다(P0 사고).
//    서버 컴포넌트라면 `FeatureGateServer` 를 써라 — 그쪽이 서버 진실을 읽는다.
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
  return <FeatureLockNotice label={label ?? feature} />;
}
