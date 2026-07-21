import { NOTICE_CATEGORY_OPTIONS } from "@/lib/notices";

const COLOR_BY_ID = new Map(NOTICE_CATEGORY_OPTIONS.map((o) => [o.id, o.color ?? null]));

/** 분류 배지 — 미지정이면 렌더하지 않는다. */
export function NoticeCategoryBadge({
  categoryId,
  label,
}: {
  categoryId: string | null;
  label: string | null;
}) {
  if (!categoryId || !label) return null;
  const color = COLOR_BY_ID.get(categoryId) ?? "#c4c4c4";
  return (
    <span
      className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-white"
      style={{ backgroundColor: color }}
    >
      {label}
    </span>
  );
}

/** 상단고정 표시. */
export function PinnedBadge({ pinned }: { pinned: boolean }) {
  if (!pinned) return null;
  return (
    <span
      className="shrink-0 text-xs text-amber-600 dark:text-amber-500"
      title="상단고정"
      aria-label="상단고정"
    >
      📌
    </span>
  );
}
