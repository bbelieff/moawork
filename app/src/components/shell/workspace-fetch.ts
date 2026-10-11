import { WORKSPACE_API_HEADER } from "@/lib/auth/workspace-api-header";
import { workspaceBaseFromPathname } from "./workspace-href";

/** 지금 주소(/w/<회사>/…)의 회사 이름표. 회사 주소가 아니면 null. */
export function currentWorkspaceSlug(pathname: string): string | null {
  return workspaceBaseFromPathname(pathname)?.slice("/w/".length) ?? null;
}

/**
 * 회사 범위 /api 호출 — 지금 탭의 회사를 머리글로 함께 보낸다(QA #887, workspace-api-header.ts).
 * 회사 주소가 아닌 화면에서는 머리글 없이 보내 예전처럼 쿠키를 따른다.
 */
export function workspaceFetch(input: string, init: RequestInit = {}, pathname?: string): Promise<Response> {
  const path = pathname ?? (typeof window === "undefined" ? "" : window.location.pathname);
  const slug = currentWorkspaceSlug(path);
  if (!slug) return fetch(input, init);
  const headers = new Headers(init.headers);
  headers.set(WORKSPACE_API_HEADER, slug);
  return fetch(input, { ...init, headers });
}
