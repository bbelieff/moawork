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
  /** IANA 시간대. worker 호스트 시간대에 의존하지 않는다. */
  timeZone: string;
  quietHours?: { startHour: number; endHour: number };
  bundleWindowMinutes?: number;
}

export interface DeliveryBatch {
  userId: string;
  eventKey: string;
  notificationIds: string[];
  deliverAfter: string;
}

function hourAt(now: Date, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { hour: "2-digit", hourCycle: "h23", timeZone }).format(now),
  );
}

function nextQuietEnd(
  now: Date,
  quiet: NonNullable<DeliveryPolicy["quietHours"]>,
  timeZone: string,
): Date | null {
  const hour = hourAt(now, timeZone);
  const overnight = quiet.startHour > quiet.endHour;
  const isQuiet = overnight
    ? hour >= quiet.startHour || hour < quiet.endHour
    : hour >= quiet.startHour && hour < quiet.endHour;
  if (!isQuiet) return null;
  const probe = new Date(now);
  for (let minutes = 1; minutes <= 24 * 60; minutes += 1) {
    probe.setTime(probe.getTime() + 60_000);
    if (hourAt(probe, timeZone) === quiet.endHour) return probe;
  }
  return null;
}

/** 같은 사용자·사건을 묶고, 긴급하지 않은 알림만 조용한 시간 뒤로 미룬다. */
export function planNotificationDelivery(
  candidates: readonly DeliveryCandidate[],
  policy: DeliveryPolicy,
): DeliveryBatch[] {
  const now = new Date(policy.now);
  const groups = new Map<string, DeliveryBatch>();
  for (const candidate of candidates) {
    // 긴급 알림은 일반 묶음과 분리해 조용한 시간 뒤로 밀리지 않게 한다.
    const key = `${candidate.userId}\u0000${candidate.eventKey}\u0000${candidate.urgency}`;
    const quietEnd =
      candidate.urgency === "high" || !policy.quietHours
        ? null
        : nextQuietEnd(now, policy.quietHours, policy.timeZone);
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
