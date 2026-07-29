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
import type { PostHog } from "posthog-js";
import { usePathname, useSearchParams } from "next/navigation";
import { capture, setAnalyticsInstance } from "@/lib/analytics/client";
import {
  applyReplayPathPolicy,
  buildPostHogOptions,
  shouldRunReplayPathGate,
  type AnalyticsConfig,
} from "@/lib/analytics/config";
import { getAnalyticsConfig } from "@/lib/analytics/env";
import { analyticsRouteTemplate, LOGIN_ATTEMPT_MARKER, loginFailureReason } from "@/lib/analytics/events";
const FIRST_WORKSPACE_ENTRY_MARKER = "mw-analytics-first-workspace-entry";
let posthogReady: Promise<PostHog | null> | null = null;

function loadPostHog(config: AnalyticsConfig): Promise<PostHog | null> {
  if (!posthogReady) {
    posthogReady = import("posthog-js")
      .then(({ default: posthog }) => {
        if (!posthog.__loaded) posthog.init(config.projectKey, buildPostHogOptions(config));
        setAnalyticsInstance(posthog);
        return posthog;
      })
      .catch(() => null);
  }
  return posthogReady;
}

function readAndClearLoginAttempt(): boolean {
  try {
    if (window.sessionStorage.getItem(LOGIN_ATTEMPT_MARKER) !== "1") return false;
    window.sessionStorage.removeItem(LOGIN_ATTEMPT_MARKER);
    return true;
  } catch {
    return false;
  }
}

function useInitPostHog(): void {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    const config = getAnalyticsConfig();
    if (!config) return;
    started.current = true;

    void loadPostHog(config);
  }, []);
}

function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!pathname) return;
    const route = analyticsRouteTemplate(pathname);
    capture("$pageview", { $current_url: `${window.location.origin}${route}` });

    if (route === "/w/:workspace") {
      try {
        if (window.sessionStorage.getItem(FIRST_WORKSPACE_ENTRY_MARKER) !== "1") {
          window.sessionStorage.setItem(FIRST_WORKSPACE_ENTRY_MARKER, "1");
          capture("first_workspace_entered", { entry: "canonical" });
        }
      } catch {
        // Storage can be unavailable. Page tracking remains fail-open.
      }
    }
  }, [pathname]);

  useEffect(() => {
    if (!pathname) return;
    if (pathname === "/login") {
      const reason = loginFailureReason(searchParams?.get("error"));
      if (reason && readAndClearLoginAttempt()) {
        capture("login_result", { outcome: "failure", reason });
      }
      return;
    }
    if (readAndClearLoginAttempt()) capture("login_result", { outcome: "success" });
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
    const config = getAnalyticsConfig();
    if (!shouldRunReplayPathGate(config, pathname) || !config || !pathname) return;

    let cancelled = false;

    void loadPostHog(config).then((posthog) => {
      if (cancelled || !posthog) return;
      applyReplayPathPolicy(posthog, config, pathname);
    });

    return () => {
      cancelled = true;
    };
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
