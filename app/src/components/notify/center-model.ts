import type { NotifySnapshot } from "@/lib/notify/server";
import { notificationTargetHref } from "@/lib/notify/highlight";
export const ROUTES: Record<string, string> = {
  mine: "내게 온 알림",
  assignment: "담당",
  direct: "직속",
  hierarchy: "계통",
  watching_department: "관전 부서",
  team: "팀 공유",
  card_person: "카드에 추가",
  card_department: "카드 부서",
  personal: "내 구독",
};
export const TYPES: Record<string, string> = {
  "deal.create": "업무 등록",
  "deal.move": "업무 단계 변경",
  "deal.update": "업무 수정",
  "notice.create": "공지 등록",
  "company.create": "회사 등록",
  "settlement.create": "정산 등록",
  "settlement.update": "정산 수정",
  "member.join_request": "합류 요청",
  "member.join_approved": "합류 승인",
  join_request: "가입 요청",
  assigned: "담당 배정",
  mention: "멘션",
  requested: "요청",
};
export type CenterItem = {
  id: string;
  title: string;
  body: string;
  actor: string;
  route: string;
  type: string;
  at: string;
  read: boolean | undefined;
  action: boolean;
  href: string | null;
  distance: number;
  path: string;
};
export type CenterFilters = {
  search: string;
  route: string;
  type: string;
  actor: string;
  company: string;
  from: string;
  to: string;
  unread: boolean;
};
export const EMPTY_FILTERS: CenterFilters = {
  search: "",
  route: "",
  type: "",
  actor: "",
  company: "",
  from: "",
  to: "",
  unread: false,
};
export function centerItems(snapshot: NotifySnapshot): CenterItem[] {
  return [
    ...snapshot.mine.map(({ notification: n, href, actorName }) => ({
      id: `mine-${n.id}`,
      title: n.title,
      body: n.body ?? "",
      actor: actorName ?? "보낸 사람 미확인",
      route: "mine",
      type: n.type,
      at: n.created_at,
      read: !!n.read_at,
      action: n.is_action && !n.resolved_at,
      href: href ? notificationTargetHref(href, n.target_id ?? n.id) : null,
      distance: 0,
      path: "",
    })),
    ...snapshot.org.map(({ group, line, href, recipient, read }) => ({
      id: `org-${group.head.id}`,
      title: `${line.actor}님이 ${line.verb}`,
      body: line.where ?? "",
      actor: line.actor,
      route: recipient.source === "hierarchy" && recipient.distance === 1 ? "direct" : recipient.source,
      type: group.head.action,
      at: group.head.at,
      read,
      action: false,
      href,
      distance: recipient.distance ?? 0,
      path: recipient.path?.join(" → ") ?? "",
    })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
export function filterCenterItems(
  items: CenterItem[],
  f: CenterFilters,
): CenterItem[] {
  return items.filter((n) => {
    const text = `${n.title} ${n.body}`.toLocaleLowerCase();
    const day = new Date(n.at).toLocaleDateString("sv-SE", {
      timeZone: "Asia/Seoul",
    });
    return (
      (!f.search ||
        `${text} ${n.actor.toLocaleLowerCase()}`.includes(
          f.search.toLocaleLowerCase(),
        )) &&
      (!f.company || text.includes(f.company.toLocaleLowerCase())) &&
      (!f.route || n.route === f.route) &&
      (!f.type || n.type === f.type) &&
      (!f.actor || n.actor === f.actor) &&
      (!f.from || day >= f.from) &&
      (!f.to || day <= f.to) &&
      (!f.unread || n.read === false)
    );
  });
}
export async function requestReadAll(
  request: typeof fetch = fetch,
): Promise<void> {
  const response = await request("/api/notifications/read-all", {
    method: "POST",
  });
  if (!response.ok)
    throw new Error("읽음 처리에 실패했어요. 다시 시도해 주세요.");
  const body = await response.json();
  if (body?.data?.ok !== true)
    throw new Error("읽음 처리 결과를 확인하지 못했어요. 다시 시도해 주세요.");
}
