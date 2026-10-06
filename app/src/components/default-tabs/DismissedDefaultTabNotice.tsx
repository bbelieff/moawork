"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { workspaceBaseFromPathname, workspaceHref } from "@/components/shell/workspace-href";
import { BOARD_TRASH_RETENTION_DAYS } from "@/lib/boards/types";

/** 탭 관리의 탭 목록 — 휴지통 복구와 «기본 탭 다시 설치» 가 있는 곳. */
export const TAB_MANAGEMENT_HREF = "/settings/workspace-builder?section=tabs";

/**
 * #849 — 회사가 지운 기본 탭의 진입 화면. 오류가 아니라 «지운 상태» 다:
 * 탭을 다시 만들지 않고, 되살리거나 새로 설치할 곳으로 안내한다.
 */
export function DismissedDefaultTabNotice({ tabName }: { tabName: string }) {
  // 지금 회사의 탭 관리로 보낸다 — 주소에서 회사를 못 읽으면 진입 화면으로 보낸다(workspaceHref).
  const href = workspaceHref(workspaceBaseFromPathname(usePathname() ?? "") ?? undefined, TAB_MANAGEMENT_HREF);
  return (
    <section
      className="mx-auto mt-6 flex max-w-md flex-col items-center rounded-lg border border-mw-line bg-mw-card px-6 py-8 text-center"
      aria-labelledby="dismissed-default-tab-title"
      data-testid="dismissed-default-tab"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-mw-tint-blue text-mw-record">
        <svg
          viewBox="0 0 24 24"
          className="h-6 w-6"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
          <path d="M10 11v6M14 11v6" />
        </svg>
      </span>
      <h1 id="dismissed-default-tab-title" className="mt-4 text-lg font-semibold text-mw-fg">
        ‘{tabName}’ 탭을 지웠어요
      </h1>
      <p className="mt-2 text-sm leading-6 text-mw-body">
        휴지통에 있으면 {BOARD_TRASH_RETENTION_DAYS}일 안에 복구할 수 있고, 완전히 지웠다면 탭 관리에서 ‘기본 탭 다시 설치’로 새로 만들 수 있어요.
      </p>
      <Link
        href={href}
        className="mt-5 rounded-md bg-mw-primary px-4 py-2 text-sm font-semibold text-mw-on-accent"
      >
        탭 관리로 가기
      </Link>
    </section>
  );
}
