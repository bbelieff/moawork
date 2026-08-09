import type { ReactNode } from "react";
import { loadLockedFeatures } from "@/lib/entitlements/server";
import { FeatureLockNotice } from "./FeatureLockNotice";

/**
 * 엔타이틀먼트 게이트 — **서버 진실판**. 서버 컴포넌트는 이걸 쓴다.
 *
 * ── 왜 따로 있나 (P0: 신규 회사 첫 화면이 잠금 한 줄) ──
 * `FeatureGate` 는 `isEnabled(ctx, key)` → `getRepo().isFeatureEnabled(...)` 를 탄다.
 * 그런데 `getRepo()` 는 환경과 무관하게 **항상 LocalRepo(인메모리 시드)** 라, 프로덕션의
 * 실제 Supabase org UUID 는 그 스토어에 없고 판정이 언제나 `false` 로 떨어진다.
 * 그래서 승인 직후 회사에 대표가 들어가면 대시보드 본문이 잠금 문구 하나로 붕괴했다.
 * 사이드바는 `(app)/layout.tsx` 에서 이미 서버 판정(`loadLockedFeatures`)으로 옮겨
 * 같은 사고를 막아 뒀는데, 화면 본문 게이트만 옛 경로에 남아 있었다.
 *
 * 판정 규칙 자체는 `lib/entitlements/resolve.ts` 가 소유한다 —
 * MVP 기능은 `org_entitlements` 행이 **없어도 기본 ON**, `enabled=false` 행이 명시됐을
 * 때만 OFF. 즉 조직 생성 시 엔타이틀먼트 행을 심지 못해도 MVP 범위는 정상 동작한다.
 * (그래서 이 사고의 해법은 시드 행 추가가 아니라 판정 경로 교체다.)
 */
export async function FeatureGateServer({
  orgId,
  feature,
  label,
  children,
  fallback,
}: {
  orgId: string;
  feature: string;
  label?: string;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const locked = await loadLockedFeatures(orgId, [feature]);
  if (!locked.includes(feature)) return <>{children}</>;
  if (fallback !== undefined) return <>{fallback}</>;
  return <FeatureLockNotice label={label ?? feature} />;
}
