// 분석 환경변수 판독기.
//
// `process.env.NEXT_PUBLIC_*` 는 Next 가 **빌드 시점에 문자열로 치환**한다.
// 동적 접근(process.env[name])은 치환되지 않으므로 반드시 리터럴로 적어야 한다.
// 그래서 "읽기"만 이 파일에 두고, 해석·검증은 config.ts 의 순수 함수가 맡는다.
//
// ⚠ 키 값은 어디에도 로그하지 않는다. 저장소에는 `.env.example` 의 형태만 있다.

import { resolveAnalyticsConfig, type AnalyticsConfig } from "./config";

export function readAnalyticsEnv(): { key?: string; host?: string } {
  return {
    key: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  };
}

/** 현재 환경의 분석 설정. 미설정·형태 불일치·테스트 환경에서는 null(비활성). */
export function getAnalyticsConfig(): AnalyticsConfig | null {
  if (process.env.NODE_ENV === "test") return null;
  return resolveAnalyticsConfig(readAnalyticsEnv());
}

/** 분석이 켜져 있는지. UI 분기(예: 안내 문구)에서 쓴다. */
export function isAnalyticsEnabled(): boolean {
  return getAnalyticsConfig() !== null;
}
