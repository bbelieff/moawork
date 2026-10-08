import type { BoardTrashImpact } from "./types";

/** 탭을 휴지통에 보내기 전에 보여 줄 «지울 내용» 한 줄(서버·화면 공용). */
export function formatTrashImpact(impact: BoardTrashImpact): string {
  const parts: Array<[string, number]> = [
    ["아이템", impact.groups],
    ["행", impact.rows],
    ["메모", impact.memos],
    ["첨부 파일", impact.files],
    ["저장된 보기", impact.views],
    ["자동화 규칙", impact.automations],
    ["문자 규칙", impact.messaging],
  ];
  return parts.map(([label, count]) => `${label} ${(Number(count) || 0).toLocaleString("ko-KR")}`).join(" · ");
}
