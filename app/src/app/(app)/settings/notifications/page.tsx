import { getSession } from "@/lib/auth/session";
import { loadNotifySnapshot } from "@/lib/notify/server";
import { NotificationCenter } from "@/components/notify/NotificationCenter";
export default async function NotificationsPage() {
  const ctx = await getSession();
  return <NotificationCenter snapshot={await loadNotifySnapshot(ctx)} />;
}
