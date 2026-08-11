export type NotificationUrgency = "normal" | "high";

export interface DeliveryCandidate {
  notificationId: string;
  userId: string;
  eventKey: string;
  createdAt: string;
  urgency: NotificationUrgency;
}
export interface DeliveryPolicy {
  now: string;
  quietHours?: { startHour: number; endHour: number };
  bundleWindowMinutes?: number;
}

export interface DeliveryBatch {
  userId: string;
  eventKey: string;
  notificationIds: string[];
  deliverAfter: string;
}

function quietHoursEnd(now: Date, quiet: NonNullable<DeliveryPolicy["quietHours"]>): Date | null {
  const hour = now.getHours();
  const overnight = quiet.startHour > quiet.endHour;
  const isQuiet = overnight
    ? hour >= quiet.startHour || hour < quiet.endHour
    : hour >= quiet.startHour && hour < quiet.endHour;
  if (!isQuiet) return null;
  const end = new Date(now);
  if (hour >= quiet.startHour && overnight) end.setDate(end.getDate() + 1);
  end.setHours(quiet.endHour, 0, 0, 0);
  return end;
}

/** 같은 사용자·사건을 묶고, 긴급하지 않은 알림만 조용한 시간 뒤로 미룬다. */
export function planNotificationDelivery(
  candidates: readonly DeliveryCandidate[],
  policy: DeliveryPolicy,
): DeliveryBatch[] {
  const now = new Date(policy.now);
  const groups = new Map<string, DeliveryBatch>();
  for (const candidate of candidates) {
    const key = `${candidate.userId}\u0000${candidate.eventKey}`;
    const quietEnd =
      candidate.urgency === "high" || !policy.quietHours
        ? null
        : quietHoursEnd(now, policy.quietHours);
    const bundleEnd = new Date(
      new Date(candidate.createdAt).getTime() + (policy.bundleWindowMinutes ?? 60) * 60_000,
    );
    const deliverAfter = new Date(Math.max(now.getTime(), bundleEnd.getTime(), quietEnd?.getTime() ?? 0));
    const current = groups.get(key);
    if (current) {
      if (!current.notificationIds.includes(candidate.notificationId)) {
        current.notificationIds.push(candidate.notificationId);
      }
      if (deliverAfter.toISOString() > current.deliverAfter) current.deliverAfter = deliverAfter.toISOString();
    } else {
      groups.set(key, {
        userId: candidate.userId,
        eventKey: candidate.eventKey,
        notificationIds: [candidate.notificationId],
        deliverAfter: deliverAfter.toISOString(),
      });
    }
  }
  return [...groups.values()];
}
