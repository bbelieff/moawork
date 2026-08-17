import type { ReactNode } from "react";
import styles from "./view.module.css";

export interface TableColumn {
  readonly key: string;
  readonly label: string;
}

/**
 * 「표」 시스템 뷰(D25) — 아이템 구분 없이 한 표. 셀 렌더는 호출부가 준다(필드 타입은 CT03 소관).
 * 보드 렌더러는 여기 없다 — components/board/**는 이 카드의 리스가 아니다.
 */
export function TableView<T>({
  columns,
  rows,
  rowKey,
  renderCell,
  textMode = "single",
  focusColumnKey = null,
  emptyLabel = "조건에 맞는 항목이 없습니다.",
}: {
  columns: readonly TableColumn[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  renderCell: (row: T, column: TableColumn) => ReactNode;
  textMode?: "single" | "wrap";
  focusColumnKey?: string | null;
  emptyLabel?: string;
}) {
  if (!rows.length) return <div className={styles.tableEmpty}>{emptyLabel}</div>;
  return (
    <div className={styles.tableWrap}>
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} data-column-key={c.key} data-view-focus={c.key === focusColumnKey || undefined}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td key={c.key} data-column-key={c.key} data-view-focus={c.key === focusColumnKey || undefined} className={textMode === "wrap" ? styles.wrapCell : styles.singleCell}>{renderCell(row, c)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
