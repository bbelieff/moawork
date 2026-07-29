"use client";

// PostHog 초기화 + App Router 페이지뷰 전송.
//
// 설계 메모
//  - SDK 는 **동적 import** 다. 분석이 꺼져 있으면(키 미설정) 번들을 아예 받지 않는다.
//  - `capture_pageview: false` 로 두고 여기서 직접 보낸다. App Router 의 soft navigation 은
//    SDK 의 history 감지와 어긋나 중복/누락이 생긴다.
//  - `useSearchParams` 는 Suspense 경계를 요구한다(Next). 그래서 추적부를 분리했다.
//  - 렌더링하는 DOM 이 없다 → 레이아웃·반응형·브랜드 토큰에 영향을 주지 않는다.

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { setAnalyticsInstance } from "@/lib/analytics/client";
import { buildPostHogOptions, isReplayExcludedPath } from "@/lib/analytics/config";
import { getAnalyticsConfig } from "@/lib/analytics/env";
import { scrubUrl } from "@/lib/analytics/scrub";

function useInitPostHog(): void {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    const config = getAnalyticsConfig();
    if (!config) return;
    started.current = true;

    let cancelled = false;
    void import("posthog-js")
      .then(({ default: posthog }) => {
        if (cancelled) return;
        posthog.init(config.projectKey, buildPostHogOptions(config));
        setAnalyticsInstance(posthog);
      })
      .catch(() => {
        // 분석 로드 실패는 제품 기능이 아니다. 조용히 비활성으로 남는다.
        // (키·호스트 값이 메시지에 실릴 수 있어 콘솔에도 남기지 않는다.)
      });

    return () => {
      cancelled = true;
    };
  }, []);
}

function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!pathname) return;
    const query = searchParams?.toString();
    const url = `${window.location.origin}${pathname}${query ? `?${query}` : ""}`;
    // $current_url 은 before_send 도 한 번 더 훑지만, 여기서 먼저 정리해 보낸다.
    void import("posthog-js").then(({ default: posthog }) => {
      if (!posthog.__loaded) return;
      posthog.capture("$pageview", { $current_url: scrubUrl(url) });
    });
  }, [pathname, searchParams]);

  return null;
}

/**
 * 회계·홈택스·정산 화면에서는 세션 리플레이를 **중단**한다.
 *
 * 텍스트 마스킹만으로는 부족하다고 본 이유: 이 화면들은 화면 구조 자체가
 * 사업자등록번호·세금계산서·정산 금액의 배치를 드러내서, 값이 가려져도
 * 레이아웃과 상호작용만으로 유추될 여지가 있다. 그래서 아예 녹화를 멈춘다.
 *
 * 경로를 벗어나면 다시 시작한다. `usePathname` 만 보므로 쿼리 변화로는 재실행되지 않는다.
 */
function ReplayPathGate() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;
    const excluded = isReplayExcludedPath(pathname);
    void import("posthog-js").then(({ default: posthog }) => {
      if (!posthog.__loaded) return;
      if (excluded) posthog.stopSessionRecording();
      else posthog.startSessionRecording();
    });
  }, [pathname]);

  return null;
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useInitPostHog();

  return (
    <>
      <Suspense fallback={null}>
        <PageViewTracker />
      </Suspense>
      <ReplayPathGate />
      {children}
    </>
  );
}
