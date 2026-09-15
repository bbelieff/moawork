"use client";
import { NotificationCenter } from "@/components/notify/NotificationCenter";
import type { NotifySnapshot } from "@/lib/notify/server";
import { feedLine } from "@/lib/notify/messages";
import type { NotificationSource } from "@/lib/notify/recipients";
/** Synthetic visual-only fixture. Read-all deliberately fails without any network request. */
export function NotificationCenterFixture() {
  const now = new Date();
  const at = (hours: number) =>
    new Date(now.getTime() - hours * 3600000).toISOString();
  const snapshot: NotifySnapshot = {
    bell: { kind: "count", count: 1, display: "1" },
    sidebar: {},
    mine: [
      {
        actorName: "검토 담당자",
        href: "/settings/members",
        notification: {
          id: "fixture-request",
          org_id: "fixture",
          user_id: "viewer",
          actor_id: "actor",
          type: "requested",
          title: "조직 구성 확인을 요청했습니다",
          body: "검토 요청 내용을 확인해 주세요.",
          target_type: null,
          target_id: null,
          is_action: true,
          read_at: null,
          resolved_at: null,
          created_at: at(1),
        },
      },
      {
        actorName: "업무 담당자",
        href: "/",
        notification: {
          id: "fixture-assigned",
          org_id: "fixture",
          user_id: "viewer",
          actor_id: "actor2",
          type: "assigned",
          title: "새 업무가 배정되었습니다",
          body: "회사 A 일정과 업무 내용을 확인해 주세요.",
          target_type: null,
          target_id: null,
          is_action: false,
          read_at: at(2),
          resolved_at: null,
          created_at: at(3),
        },
      },
    ],
    org: (["assignment", "hierarchy", "team"] as NotificationSource[]).map(
      (source, i) => {
        const head = {
          id: `fixture-feed-${i}`,
          org_id: "fixture",
          actor: `actor-${i}`,
          action: i === 2 ? "notice.create" : "deal.update",
          target_type: null,
          target_id: null,
          at: at(i + 4),
        };
        return {
          group: { head, count: 1, items: [head] },
          line: feedLine(head, `공유 담당자 ${i + 1}`, now, 1),
          href: "/",
          read: i === 2,
          recipient: {
            userId: "viewer",
            source,
            sources: [source],
            locked: true,
            distance: i === 1 ? 2 : 0,
            path: i === 1 ? ["담당", "팀 책임자", "나"] : undefined,
          },
        };
      },
    ),
  };
  return (
    <>
      <p style={{ fontSize: 12, marginBottom: 12 }}>
        화면 검증용 가상 알림입니다. 모두 읽음은 네트워크 요청 없이 실패 상태를
        확인합니다.
      </p>
      <NotificationCenter
        snapshot={snapshot}
        readAll={async () => {
          throw new Error("검증용 읽음 실패: 알림 상태는 그대로 유지됩니다.");
        }}
      />
    </>
  );
}
