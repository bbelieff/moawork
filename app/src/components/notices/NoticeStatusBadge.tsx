import { NOTICE_STATUS_LABEL, type NoticeStatus } from "@/lib/notices";

/**
 * 게시 상태 배지 (BBE-17).
 *
 * "게시 중"은 기본 상태라 배지를 달지 않는다 — 예외 상태(예약·종료)만 눈에 띄게 한다.
 * 이 두 상태는 관리자에게만 보인다(일반 구성원 목록에서는 애초에 걸러진다).
 */
export function NoticeStatusBadge({ status }: { status: NoticeStatus }) {
  if (status === "published") return null;
  const scheduled = status === "scheduled";
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${
        scheduled
          ? "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300"
          : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
      }`}
    >
      {NOTICE_STATUS_LABEL[status]}
    </span>
  );
}
