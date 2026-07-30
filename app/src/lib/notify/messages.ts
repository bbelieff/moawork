/**
 * 소식 문구 · 딥링크.
 *
 * ★ 프라이버시 규칙: 문구에 **금액·고객 개인정보를 넣지 않는다.**
 *   "정산이 등록되었습니다" 까지만 쓰고 얼마인지는 쓰지 않는다.
 *   그래서 문구는 자유 문자열 조립이 아니라 **고정 템플릿 + 주어(행위자)** 로만 만든다.
 *   금액·연락처 같은 값은 애초에 이 모듈에 들어오지 않는다(파라미터로 받지 않는다).
 *
 * 형식: [아이콘] [누가] [무엇을] [어디서] [시간] — 주어를 반드시 표시한다.
 */

import type { FeedItem } from "./types";

/** 행위자 표시명. 이름이 없으면 익명 표기(개인정보 노출 대신). */
export function actorLabel(name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "알 수 없는 사용자";
}

/** action → [아이콘, 서술어] 고정 템플릿. 값(금액 등)은 절대 포함하지 않는다. */
const ACTION_TEMPLATES: Record<string, { icon: string; verb: string; where: string }> = {
  "deal.create": { icon: "🔥", verb: "딜을 등록했습니다", where: "업무관리" },
  "deal.move": { icon: "➡️", verb: "딜 단계를 옮겼습니다", where: "업무관리" },
  "deal.update": { icon: "✏️", verb: "딜을 수정했습니다", where: "업무관리" },
  "company.create": { icon: "🏢", verb: "업체를 등록했습니다", where: "업체관리" },
  "settlement.create": { icon: "₩", verb: "정산이 등록되었습니다", where: "회계" },
  "settlement.update": { icon: "₩", verb: "정산을 수정했습니다", where: "회계" },
  "notice.create": { icon: "📋", verb: "공지를 올렸습니다", where: "공지사항" },
  "member.join_request": { icon: "👥", verb: "합류를 요청했습니다", where: "멤버관리" },
  "member.join_approved": { icon: "✅", verb: "합류가 승인되었습니다", where: "멤버관리" },
};

const FALLBACK = { icon: "•", verb: "변경했습니다", where: "" } as const;

export interface FeedLine {
  icon: string;
  /** 누가 */
  actor: string;
  /** 무엇을 */
  verb: string;
  /** 어디서 */
  where: string;
  /** 시간(상대 표기) */
  when: string;
  /** 합쳐 읽기용 한 줄. */
  text: string;
}

/** 상대 시간 — 초 단위 노출 없이 사람이 읽는 단위로. */
export function relativeTime(at: string, now: Date): string {
  const diffMs = now.getTime() - new Date(at).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}시간 전`;
  const day = Math.floor(hour / 24);
  if (day < 7) return `${day}일 전`;
  return `${Math.floor(day / 7)}주 전`;
}

/**
 * 피드 1건 → 표시 줄.
 * count > 1 이면 묶음 표현("딜 5건을 이동")으로 바꾼다.
 */
export function feedLine(
  item: FeedItem,
  actorName: string | null,
  now: Date,
  count = 1,
): FeedLine {
  const tpl = ACTION_TEMPLATES[item.action] ?? FALLBACK;
  const actor = actorLabel(actorName);
  const verb = count > 1 ? `${tpl.verb} (${count}건)` : tpl.verb;
  const when = relativeTime(item.at, now);
  const where = tpl.where;
  const text = [actor, verb, where ? `· ${where}` : "", `· ${when}`]
    .filter((p) => p.length > 0)
    .join(" ");

  return { icon: tpl.icon, actor, verb, where, when, text };
}

/**
 * 딥링크 — 항목 클릭 시 대상 화면으로 바로 이동(벨 1클릭 + 항목 1클릭 = 2클릭).
 *
 * 실제 존재하는 라우트로만 보낸다(확인: /settings/members/approvals · /settings/members ·
 * /policyfund · /notices · /boards). 승인 화면은 이미 있으므로 그대로 쓴다.
 * ⚠ /boards/[id] 의 [id] 는 **보드 id** 이지 딜 id 가 아니다 — 딜을 그리로 보내면 404 다.
 * 딜·정산은 정책자금 보드(업무관리)에서 렌더되므로 /policyfund 로 보낸다.
 * ?focus=<id> 는 상세 뷰가 생기면 쓸 힌트이며, 지금은 무시돼 무해하다.
 */
export function deepLink(targetType: string | null, targetId: string | null): string | null {
  if (!targetType) return null;
  const focus = targetId ? `?focus=${encodeURIComponent(targetId)}` : "";
  switch (targetType) {
    case "member_approval":
      return "/settings/members/approvals";
    case "member":
      return "/settings/members";
    case "deal":
    case "settlement":
      return `/policyfund${focus}`;
    case "company":
      return `/boards${focus}`;
    case "notice":
      return "/notices";
    default:
      return null;
  }
}
