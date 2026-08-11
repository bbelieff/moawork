export const NOTIFICATION_HIGHLIGHT_PARAM = "notification";

export function notificationTargetHref(href: string, notificationId: string): string {
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}${NOTIFICATION_HIGHLIGHT_PARAM}=${encodeURIComponent(notificationId)}`;
}
export function isNotificationHighlighted(
  notificationId: string | null | undefined,
  currentNotificationId: string | null | undefined,
): boolean {
  return Boolean(notificationId && notificationId === currentNotificationId);
}
