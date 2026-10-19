/**
 * Esc 를 지금 «열린 목록»이 먼저 써야 하는가 (2026-10-19 web-design-guidelines 검토).
 *
 * 콤보박스 추천 목록이 열린 채 Esc 를 누르면 목록만 닫혀야 한다. 바깥 창(새 회사 등록·상세 패널)이
 * 먼저 Esc 를 잡아 창째 닫으면 입력한 내용이 사라진다.
 */
export function escapeOwnedByOpenList(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  const combobox = target.closest('[role="combobox"]');
  return Boolean(combobox && combobox.getAttribute("aria-expanded") === "true");
}
