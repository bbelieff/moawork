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
import { buildPostHogOptions } from "@/lib/analytics/config";
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

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useInitPostHog();

  return (
    <>
      <Suspense fallback={null}>
        <PageViewTracker />
      </Suspense>
      {children}
    </>
  );
}
