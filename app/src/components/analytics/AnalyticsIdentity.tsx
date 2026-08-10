"use client";

// 필수 속성(org_id·role·plan_tier·app_version) 등록 + 사용자 식별.
//
// 왜 별도 컴포넌트인가: PostHogProvider 는 루트 레이아웃(미인증 화면 포함)에 있고,
// 세션은 인증 셸 안에서만 존재한다. 그래서 "세션을 아는 자리"에서 이 컴포넌트를 렌더해
// 값을 넘긴다. 렌더링하는 DOM 은 없다.
//
// ⚠ 식별자는 **내부 UUID 만**. 이메일·이름은 넘기지 않는다(배정 하드 금지 항목).
//   그래서 props 에 이메일을 받을 자리 자체를 두지 않았다.

import { useEffect } from "react";
import { identify, registerAnalyticsContext } from "@/lib/analytics/client";
import { APP_VERSION } from "@/lib/analytics/version";

export type AnalyticsIdentityProps = {
  /** 사용자 UUID(내부 식별자). 이메일 금지. */
  userId: string;
  /** 조직 UUID. */
  orgId: string;
  /** 역할 enum — owner | admin | member. */
  role: string;
  /** 요금제 enum. */
  planTier: string;
};

/** UUID 형태만 식별자로 인정한다 — 이메일·상호가 잘못 흘러드는 경로를 막는다. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function AnalyticsIdentity({
  userId,
  orgId,
  role,
  planTier,
}: AnalyticsIdentityProps) {
  useEffect(() => {
    // 필수 4종은 식별 여부와 무관하게 항상 등록한다(이후 모든 이벤트에 자동으로 붙는다).
    registerAnalyticsContext({
      org_id: orgId,
      role,
      plan_tier: planTier,
      app_version: APP_VERSION,
    });

    // distinct_id 는 내부 UUID 일 때만. 아니면 식별하지 않는다(익명 유지).
    if (UUID_RE.test(userId)) {
      identify(userId, { org_id: orgId, role, plan_tier: planTier });
    }
  }, [userId, orgId, role, planTier]);

  return null;
}
