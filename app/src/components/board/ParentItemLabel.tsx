/** Names come only from the current authorized visible rows, never a separate lookup. */
export function ParentItemLabel({ parentId, title }: { parentId?: string | null; title?: string }) {
  if (!parentId) return null;
  return <span className="block min-w-0 truncate text-xs text-mw-sub" aria-label="현재 상위 항목">
    상위: {title ?? "현재 보기에서 확인할 수 없음"}
  </span>;
}
