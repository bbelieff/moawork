export const NOTIFICATION_HIGHLIGHT_PARAM = "notification";

export function notificationTargetHref(href: string, notificationId: string): string {
  const [path, query = ""] = href.split("?", 2);
  const params = new URLSearchParams(query);
  params.set(NOTIFICATION_HIGHLIGHT_PARAM, notificationId);
  return `${path}?${params}`;
}
export function isNotificationHighlighted(
  notificationId: string | null | undefined,
  currentNotificationId: string | null | undefined,
): boolean {
  return Boolean(notificationId && notificationId === currentNotificationId);
}
