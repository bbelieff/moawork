/**
 * 탭 설정 대화상자(#845 개선안, 2026-10-08)가 보여 줄 «단계» 목록과 짧은 안내를 만든다.
 *
 * 순수 모듈이다 — 서버 화면과 시각 픽스처가 같은 값을 만들고, 단계 점 색은 표의 그룹 띠와 같은
 * 규칙(group-tone)으로 정한다. 단계와 그룹이 연결된 탭(계약업체 실무)은 이동 규칙이 가리키는 대표
 * 단계로 깊이를 정한다 — 띠 이름을 바꿔도 색이 유지된다(BoardWorkspace 와 같은 눈).
 */

import type { BoardColumn, BoardGroup } from "./types";
import { groupToneAccent, resolveGroupTones } from "./group-tone";
import { primaryStageForGroup } from "./moveRules";
import { groupLinkedStageColumnKey } from "./stage-link";
import { CONTACT_TAB_SOURCE, NEW_LEAD_TAB_SOURCE } from "@/lib/default-tabs/types";

export type TabStageRow = Readonly<{
  id: string;
  name: string;
  /** 단계 점 색(CSS 값) — 표의 그룹 띠와 같은 톤 토큰. */
  accent: string;
  /** 지금 화면에 보이는(권한 안의) 행 수. */
  rowCount: number;
}>;

/** 그룹 순서대로 단계 줄을 만든다. 행 수는 넘겨받은 행(권한으로 거른 것)만 센다. */
export function tabStageRows(
  source: string | null | undefined,
  columns: readonly BoardColumn[],
  groups: readonly BoardGroup[],
  rows: readonly { group_id: string | null }[],
): TabStageRow[] {
  const ordered = [...groups].sort((a, b) => a.sort_order - b.sort_order);
  const linkedKey = groupLinkedStageColumnKey(source);
  const stageColumn = linkedKey ? columns.find((column) => column.key === linkedKey) ?? null : null;
  const stageByGroup = new Map<string, string>();
  if (stageColumn) {
    for (const group of ordered) {
      const stage = primaryStageForGroup(stageColumn, ordered, group.id);
      if (stage) stageByGroup.set(group.id, stage);
    }
  }
  const tones = resolveGroupTones(source, ordered.map((group) => ({ key: group.id, name: group.name })), stageByGroup);
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.group_id) counts.set(row.group_id, (counts.get(row.group_id) ?? 0) + 1);
  }
  return ordered.map((group) => ({
    id: group.id,
    name: group.name,
    accent: groupToneAccent(tones.get(group.id)),
    rowCount: counts.get(group.id) ?? 0,
  }));
}

/** 단계 칸 맨 위 한 줄 안내 — 옛 「업무 흐름」 상자를 대신한다. 흐름이 없는 탭은 null. */
export function tabStageNote(source: string | null | undefined): string | null {
  if (groupLinkedStageColumnKey(source)) {
    return "단계 = 보드예요. 여기서 이름·순서를 바꾸면 «진행현황» 선택지도 같이 바뀌고, 진행현황을 바꾸면 업체가 그 보드로 옮겨 가요.";
  }
  if (source === NEW_LEAD_TAB_SOURCE) {
    return "상담 상황을 바꾸면 행이 맞는 단계로 옮겨 가요. 다음 탭으로 넘길 때는 표 맨 오른쪽 «진행현황»을 써요.";
  }
  if (source === CONTACT_TAB_SOURCE) {
    return "표 맨 오른쪽 «업무이동»을 «업무관리 이동»으로 바꾸면 이름 아래 이동 단추가 나와요. 필수 정보를 확인한 뒤 넘겨요.";
  }
  return null;
}

/** 대화상자 머리말의 작은 설명(칸 이름 옆). */
export function tabSettingsSubtitles(
  source: string | null | undefined,
  columnCount: number,
  stageCount: number,
): Readonly<{ general: string; fields: string; stages: string }> {
  return {
    general: "이름 · 아이콘 · 설명",
    fields: `${columnCount}개`,
    stages: groupLinkedStageColumnKey(source) ? `${stageCount}개 · 진행현황과 연결` : `${stageCount}개`,
  };
}
