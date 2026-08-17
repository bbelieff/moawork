import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TableView } from "./TableView";

describe("saved presentation rendering", () => {
  it("renders wrap mode and the focused column into the actual table cells", () => {
    const html = renderToStaticMarkup(
      <TableView
        columns={[{ key: "title", label: "Title" }, { key: "status", label: "Status" }]}
        rows={[{ id: "1", title: "long text", status: "open" }]}
        rowKey={(row) => row.id}
        renderCell={(row, column) => row[column.key as "title" | "status"]}
        textMode="wrap"
        focusColumnKey="status"
      />,
    );
    expect(html).toContain("wrapCell");
    expect(html.match(/data-view-focus="true"/g)).toHaveLength(2);
  });
});
