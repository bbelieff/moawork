/**
 * mod.notify — 인앱 알림(뱃지 · 소식창).
 *
 * ★ 핵심 계약(badge.ts + badge.test.ts): "봤다"와 "했다"는 다른 축이다.
 *   숫자 = 내가 할 일 → 화면 진입으로 사라지지 않고, 처리해야 사라진다.
 *   점   = 안 본 변화 → 화면에 들어가면 사라진다.
 *
 * server.ts 는 "server-only" 라 클라이언트에서 import 하지 않는다(배럴에서 제외).
 */
export * from "./types";
export * from "./badge";
export * from "./grouping";
export * from "./messages";
export * from "./visibility";
export * from "./recipients";
export * from "./highlight";
