"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, WORK_TOOL_ITEMS } from "@/components/shell/nav-items";
import { resolveActiveNavKey } from "@/components/shell/active-nav";
import { workspaceHref } from "@/components/shell/workspace-href";
import {
  APPEARANCE_DEFAULT,
  APPEARANCE_PRESET_GRADS,
  APPEARANCE_PRESET_SOLID,
  APPEARANCE_STORAGE_KEY,
  parseAppearancePreference,
  parseAppearanceStorageText,
  resolveRouteAccent,
  serializeAppearancePreference,
  type AppearancePreference,
} from "@/lib/appearance/vivid";

/** 같은 탭의 AppearanceControl·RouteAppearance가 저장 변경을 나누는 채널. */
export const APPEARANCE_CHANGE_EVENT = "moawork:appearance-change";

/** 본인 외관 설정 읽기 — 실패하면 기본값, 던지지 않는다. */
export function readAppearancePreference(): AppearancePreference {
  try {
    return parseAppearanceStorageText(window.localStorage.getItem(APPEARANCE_STORAGE_KEY));
  } catch {
    return { ...APPEARANCE_DEFAULT };
  }
}

/**
 * 문서 상태에 반영한다. 렌더 중이 아니라 이벤트·이펙트에서만 호출한다.
 * 업무 데이터·워크스페이스 상태는 만지지 않는다(외관만).
 */
export function applyAppearancePreference(pref: AppearancePreference): void {
  const clean = parseAppearancePreference(pref);
  const root = document.documentElement;
  root.setAttribute("data-moa-theme", clean.preset);
  root.style.setProperty("--mw-company-grad", APPEARANCE_PRESET_GRADS[clean.preset].grad);
  root.style.setProperty("--mw-company-solid", APPEARANCE_PRESET_SOLID[clean.preset]);
  root.setAttribute("data-mw-effects", clean.effects);
}

/** 저장 + 문서 반영 + 같은 탭 알림. */
export function storeAppearancePreference(pref: AppearancePreference): AppearancePreference {
  const clean = parseAppearancePreference(pref);
  try {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, serializeAppearancePreference(clean));
  } catch {
    // 프라이빗 모드 등 저장 실패 — 이번 세션 화면에만 반영하고 조용히 넘어간다.
  }
  applyAppearancePreference(clean);
  window.dispatchEvent(new CustomEvent(APPEARANCE_CHANGE_EVENT));
  return clean;
}

/**
 * 라우트 팔레트·외관 배선 전담 부품. DOM을 그리지 않는다.
 * - 활성 nav는 SidebarNav와 같은 resolveActiveNavKey로 하나만 고른다.
 *   보드 주소(/boards/<id>)는 boardNavKeys 지도로 탭을 되찾고, 모르는 보드는
 *   대시보드 강조로 폴백한다(엉뚱한 탭 잔상 금지).
 * - 저장된 본인 외관(프리셋·효과)을 문서 상태에 올린다.
 */
export function RouteAppearance({
  boardNavKeys,
  basePath,
}: {
  boardNavKeys?: Readonly<Record<string, string>>;
  basePath?: string;
}) {
  const pathname = usePathname();

  useEffect(() => {
    const candidates = [...NAV_ITEMS, ...WORK_TOOL_ITEMS]
      .filter((item) => item.href)
      .map((item) => ({
        key: item.key,
        href: workspaceHref(basePath, item.href!).split(/[?#]/)[0],
      }));
    const active = resolveActiveNavKey(pathname ?? "", candidates, { basePath, boardNavKeys });
    document.documentElement.setAttribute("data-mw-accent", resolveRouteAccent(active));
  }, [pathname, boardNavKeys, basePath]);

  useEffect(() => {
    applyAppearancePreference(readAppearancePreference());
    const onChange = () => applyAppearancePreference(readAppearancePreference());
    const onStorage = (event: StorageEvent) => {
      if (event.key === APPEARANCE_STORAGE_KEY) onChange();
    };
    window.addEventListener(APPEARANCE_CHANGE_EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(APPEARANCE_CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return null;
}
