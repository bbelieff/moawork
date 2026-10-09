import { NAV_ITEMS, WORK_TOOL_ITEMS } from "./nav-items";
import { resolveActiveNavKey, resolveConsultationNavKey } from "./active-nav";
import { workspaceHref } from "./workspace-href";

/**
 * 셸 메뉴(사이드바·휴대폰 아래 메뉴)가 «지금 켤 메뉴 키» 하나를 고른다 — 둘이 같은 답을 내야 한다.
 *
 * 활성은 «항목마다» 가 아니라 «전체에서 하나» 다 — 둘이 켜지면 색으로 구분하는 목적이 깨진다.
 * 같은 리드컨택 정본 보드라도 ?consultation=remote|inperson 이면 STEP2·STEP3 탭이 켜진다.
 * 옛 리드컨택 주소(contact)는 화면에 없는 메뉴라 STEP2(비대면 상담)로 켠다.
 */
export function resolveShellActiveKey(
  pathname: string,
  search: string,
  workspaceBasePath: string | undefined,
  boardNavKeys: Readonly<Record<string, string>> | undefined,
): string | null {
  const consultationKey = resolveConsultationNavKey(pathname, search, boardNavKeys);
  const resolved = consultationKey ?? resolveActiveNavKey(
    pathname,
    [...NAV_ITEMS, ...WORK_TOOL_ITEMS].filter((item) => item.href).map((item) => ({
      key: item.key,
      href: workspaceHref(workspaceBasePath, item.href!).split(/[?#]/)[0],
    })),
    { basePath: workspaceBasePath, boardNavKeys },
  );
  return resolved === "contact" ? "consult-remote" : resolved;
}
