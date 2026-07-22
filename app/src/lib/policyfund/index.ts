// T09 · 정책자금 업종팩(ind.policyfund) + 정산(settlements) 공개 API.
export * from "./types";
export * from "./presets";
export * from "./board";
export * from "./settlement";
export * from "./pipeline";

// ⚠ `./settlements`(정산 업무로직)는 배럴에서 제외한다 — 서버 전용.
//    @/lib/crm → auth/session.ts → next/headers 를 끌어오므로, 이 배럴을 쓰는
//    "use client" 컴포넌트(PolicyfundBoard 등)의 번들에 서버 전용 API 가 섞여
//    프로덕션 빌드가 깨진다. 서버 소비자(API 라우트)는
//    `@/lib/policyfund/settlements` 를 직접 import 할 것.
