import type { NotificationRecipient } from "@/lib/notify/recipients";

const labels = {
  assignment: "담당",
  hierarchy: "보고 계통",
  watching_department: "관전 부서",
  team: "팀 공유",
  card_person: "카드에 추가",
  card_department: "카드 부서",
  personal: "내 구독",
} as const;

export function notificationRouteTone(distance = 0) {
  if (distance <= 1) return { rail: "var(--mw-people)", background: "var(--mw-soft)" };
  if (distance === 2) return { rail: "color-mix(in srgb, var(--mw-people) 55%, transparent)", background: "transparent" };
  return { rail: "color-mix(in srgb, var(--mw-people) 30%, transparent)", background: "transparent" };
}
/** D20: 직속은 진하게, 멀어진 보고 계통은 단계별로 옅게 표시한다. */
export function NotificationRoute({ recipient }: { recipient: NotificationRecipient }) {
  const tone = notificationRouteTone(recipient.distance);
  const path = recipient.path?.join(" → ");
  return (
    <span
      data-notification-source={recipient.source}
      className="block rounded-r-lg border-l-4 px-3 py-2 text-[12px]"
      style={{ borderLeftColor: tone.rail, background: tone.background }}
    >
      <span className="font-semibold">{labels[recipient.source]}</span>
      {recipient.locked ? <span aria-label="규칙에 따라 받는 사람"> · 잠김</span> : null}
      {path ? <span className="mt-1 block opacity-65">{path}</span> : null}
    </span>
  );
}
