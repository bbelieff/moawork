// T07 · 운영 분석 ③ 종합 인사이트 (①매출지표 × ②사용자행동지표).
//
// 3분면 구조(belie 확정):
//   ① 매출지표          — DB 확정값. 우리 저장소가 원천이라 정확하다.
//   ② 사용자행동지표    — PostHog 추정값. 샘플링·차단·동의 거부로 실제보다 낮게 잡힌다.
//   ③ 종합 인사이트     — ①×②. **확정값과 추정값을 섞은 값이므로 추정으로 표기한다.**
//
// 원칙: ②가 없으면 ③은 계산하지 않고 `available:false` 로 둔다.
//       확정값만으로 ③을 만들어 놓고 "종합"이라 부르면 근거를 과장하는 것이다.

import type { RevenueMetrics } from "./types";

/** 지표의 근거 등급 — 화면에 그대로 표기한다. */
export type Confidence = "confirmed" | "estimated";

/** ② 사용자행동지표(PostHog). 서버 조회가 불가하면 available=false. */
export interface BehaviorMetrics {
  available: boolean;
  /** 활성 사용자(추정). */
  activeUsers: number;
  /** 세션 수(추정). */
  sessions: number;
  /** 신규 가입 유입(추정). */
  signups: number;
  /** 활성화(핵심 행동 도달) 사용자 수(추정). */
  activated: number;
  /** 미가용 사유 — 화면에 그대로 보여준다. */
  reason: string;
}

/** ②가 없을 때의 기본값. 숫자를 0으로 두되 available=false 로 구분한다. */
export function unavailableBehavior(reason: string): BehaviorMetrics {
  return {
    available: false,
    activeUsers: 0,
    sessions: 0,
    signups: 0,
    activated: 0,
    reason,
  };
}

export interface CombinedInsight {
  available: boolean;
  /** 항상 'estimated' — 추정값이 한쪽이라도 섞이면 전체가 추정이다. */
  confidence: Confidence;
  /** ARPU = MRR ÷ 활성 사용자. 활성자가 0이면 null. */
  arpu: number | null;
  /** 활성화율 = 활성화 사용자 ÷ 활성 사용자. */
  activationRate: number;
  /** 가입당 매출 = MRR ÷ 신규 가입. 가입이 0이면 null. */
  revenuePerSignup: number | null;
  /** 사용자당 세션 = 세션 ÷ 활성 사용자. */
  sessionsPerUser: number;
  reason: string;
}

function safeDiv(a: number, b: number): number | null {
  return Number.isFinite(b) && b > 0 ? a / b : null;
}

/**
 * ③ 종합 인사이트.
 * ②가 미가용이면 계산하지 않는다 — 근거 없는 수치를 만들지 않기 위함이다.
 */
export function combineInsight(
  revenue: RevenueMetrics,
  behavior: BehaviorMetrics,
): CombinedInsight {
  if (!behavior.available) {
    return {
      available: false,
      confidence: "estimated",
      arpu: null,
      activationRate: 0,
      revenuePerSignup: null,
      sessionsPerUser: 0,
      reason: behavior.reason,
    };
  }

  return {
    available: true,
    // 매출은 확정값이지만 분모가 추정값이므로 결과는 추정이다.
    confidence: "estimated",
    arpu: safeDiv(revenue.mrr, behavior.activeUsers),
    activationRate: safeDiv(behavior.activated, behavior.activeUsers) ?? 0,
    revenuePerSignup: safeDiv(revenue.mrr, behavior.signups),
    sessionsPerUser: safeDiv(behavior.sessions, behavior.activeUsers) ?? 0,
    reason: "매출(확정) × 사용자 행동(추정) — 결과는 추정값입니다.",
  };
}

/**
 * PostHog 서버 조회 가능 여부.
 *
 * 현재 저장소의 분석 설정은 **클라이언트 전용 공개 키**(`NEXT_PUBLIC_POSTHOG_KEY`)만 있다.
 * 서버에서 집계를 읽으려면 PostHog **Query API 개인 키**(`phx_...`)가 따로 필요하다.
 * 그 키가 없으면 ②는 미가용이며, 여기서 임의 수치를 만들지 않는다.
 */
export const POSTHOG_SERVER_KEY_ENV = "POSTHOG_QUERY_API_KEY";

export function behaviorFromEnv(apiKey: string | undefined): BehaviorMetrics {
  if (!apiKey) {
    return unavailableBehavior(
      `사용자 행동 지표는 PostHog Query API 키(${POSTHOG_SERVER_KEY_ENV})가 주입되면 표시됩니다. ` +
        "현재 저장소에는 클라이언트 공개 키만 있어 서버에서 집계를 읽을 수 없습니다.",
    );
  }
  // 키가 주입되면 여기서 PostHog Query API 를 호출한다(Phase 2).
  return unavailableBehavior(
    "PostHog Query API 연동은 다음 단계입니다. 키는 확인되었습니다.",
  );
}
