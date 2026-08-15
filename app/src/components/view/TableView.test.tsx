import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TableView } from "./TableView";

interface Row {
  id: string;
  name: string;
}

describe("TableView", () => {
  it("컬럼·행을 렌더한다", () => {
    const html = renderToStaticMarkup(
      <TableView<Row>
        columns={[{ key: "name", label: "이름" }]}
        rows={[{ id: "r1", name: "우진산업㈜" }]}
        rowKey={(r) => r.id}
        renderCell={(r, c) => (c.key === "name" ? r.name : null)}
      />,
    );
    expect(html).toContain("이름");
    expect(html).toContain("우진산업㈜");
  });

  it("빈 결과는 안내 문구를 보여준다", () => {
    const html = renderToStaticMarkup(
      <TableView<Row> columns={[{ key: "name", label: "이름" }]} rows={[]} rowKey={(r) => r.id} renderCell={(r) => r.name} />,
    );
    expect(html).toContain("조건에 맞는 항목이 없습니다");
  });
});
