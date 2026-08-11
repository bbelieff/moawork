/**
 * 구조 팩 설치 결과의 1회성 전달(flash) — BBE-102.
 *
 * `cellFlash.ts` 와 같은 이유·같은 방식: 보드 목록은 클라이언트 JS 없이 서버 액션
 * 폼으로 동작하므로, 액션이 남긴 결과를 쿠키에 담아 다음 렌더에서 서버 컴포넌트가 읽는다.
 * `actions.ts` 는 `"use server"` 파일이라 async 함수만 export 할 수 있어 동기 헬퍼는
 * 여기(별도 모듈)에 둔다.
 */

import type { InstallResult } from "@/lib/structure-packs";

export const PACK_INSTALL_FLASH_COOKIE = "mw_pack_install";
export const PACK_INSTALL_FLASH_MAX_AGE = 10;

export type PackInstallFlash = {
  /** 새로 생성된 보드 수. */
  boards: number;
  /** 새로 생성된 보드들의 그룹 합계. */
  groups: number;
  /** 이미 있어서 건너뛴 보드 수(재실행 안전). */
  skipped: number;
};

export function encodePackInstallFlash(result: InstallResult): string {
  const flash: PackInstallFlash = {
    boards: result.boards.length,
    groups: result.boards.reduce((sum, b) => sum + b.groupIds.length, 0),
    skipped: result.skipped.length,
  };
  return encodeURIComponent(JSON.stringify(flash));
}

/** 쿠키 값 → 플래시. 형식이 어긋나면 표시하지 않는다(`null`). */
export function decodePackInstallFlash(raw: string | undefined | null): PackInstallFlash | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const { boards, groups, skipped } = obj;
  if (typeof boards !== "number" || typeof groups !== "number" || typeof skipped !== "number") {
    return null;
  }
  return { boards, groups, skipped };
}
