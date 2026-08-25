import type { ReactNode } from "react";

/**
 * 총괄 직접 지시(2026-08-25): **가로 탭 줄을 없앤다.**
 *   「위에 탭이름 반복해서 가로로 나오는거 … 필요가 없는거야 … 아예 이게 페이지에 뜨지 않게」
 *
 * 왼쪽 사이드바가 이미 같은 여섯 곳(신규리드 관리·리드컨택 관리·계약업체 실무·
 * 업체관리 현황·공지사항·프리셋 라이브러리)을 그리고 있어서 같은 것이 두 번 보였다.
 *
 * ★ 이 route group 자체는 남긴다. `(tabs)` 는 «업무 여섯 화면» 이라는 묶음의 이름이고
 *   경로(`/newcust` 등)에 영향을 주지 않는다. 지우면 여섯 화면의 경로가 전부 흔들린다.
 *   탭 «데이터»(`components/shell/app-tabs.ts`)도 남긴다 — 사이드바·경로 판정·
 *   목업 대조(qa-app)가 그것을 읽는다. 없앤 것은 «가로로 그리던 부품» 하나다.
 */
export default function TabsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
