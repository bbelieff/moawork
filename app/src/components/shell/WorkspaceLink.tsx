"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";
import { workspaceBaseFromPathname, workspaceHref } from "./workspace-href";

/**
 * Issue 857 — 서버 화면이 만든 앱 안 링크(`/boards/<id>?view=kanban` 등)를 지금 주소의 워크스페이스
 * 뿌리(`/w/acme`) 아래로 보낸다.
 *
 * 왜: 뿌리 없는 주소를 누르면 프록시가 `/w/<slug>/...` 로 한 번 더 튕긴다(307 → 서버 왕복 한 벌).
 * 탭 화면의 보기 전환·뒤로·칸반 칩이 매번 그 값을 냈다. 서버 화면은 base 를 모르고(프록시가
 * 주소를 바꿔 넘김) 알려면 DB 를 더 읽어야 하므로, 브라우저 주소에서 되읽는다.
 *
 * 뿌리를 못 읽으면(이미 뿌리 없는 주소로 들어온 경우) 받은 주소 그대로 — 이동을 막지 않는다.
 */
export function WorkspaceLink({ href, ...rest }: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const base = workspaceBaseFromPathname(usePathname() ?? "");
  return <Link {...rest} href={base ? workspaceHref(base, href) : href} />;
}
