/**
 * 반복 행동 묶기 — "박실장님이 딜 5건을 이동".
 *
 * 같은 사람이 짧은 시간에 같은 행동을 반복하면 한 줄로 접는다.
 * 피드가 한 사람의 연속 작업으로 도배되는 것을 막는 목적이라, 시간 순서가
 * 끊기면(사이에 다른 사람 활동이 오면) 묶지 않는다 — 연속 구간만 묶는다.
 */

import type { FeedItem } from "./types";

/** 묶음 판정 시간 창(기본 10분). */
export const GROUP_WINDOW_MS = 10 * 60 * 1000;

export interface FeedGroup {
  /** 묶음의 대표(가장 최근) 항목. */
  head: FeedItem;
  /** 묶인 건수(1이면 단건). */
  count: number;
  /** 묶인 항목 전부(최신순). */
  items: FeedItem[];
}

/**
 * 최신순으로 정렬된 피드를 연속 구간 단위로 묶는다.
 * 입력이 정렬돼 있지 않을 수 있으므로 내부에서 최신순 정렬 후 처리한다.
 */
export function groupFeed(
  items: readonly FeedItem[],
  windowMs: number = GROUP_WINDOW_MS,
): FeedGroup[] {
  const sorted = [...items].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const groups: FeedGroup[] = [];

  for (const item of sorted) {
    const last = groups[groups.length - 1];
    const sameKind =
      last !== undefined && last.head.actor === item.actor && last.head.action === item.action;
    // 묶음의 가장 오래된 항목과의 간격으로 판단한다(꼬리가 계속 늘어나는 것 방지).
    const tail = last?.items[last.items.length - 1];
    const withinWindow =
      tail !== undefined &&
      new Date(tail.at).getTime() - new Date(item.at).getTime() <= windowMs;

    if (last && sameKind && withinWindow) {
      last.items.push(item);
      last.count += 1;
      continue;
    }
    groups.push({ head: item, count: 1, items: [item] });
  }

  return groups;
}
