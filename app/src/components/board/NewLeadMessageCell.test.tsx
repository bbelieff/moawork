import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

import { NewLeadMessageCell } from "./NewLeadMessageCell";

const row = {
  id: "item-a",
  org_id: "org-a",
  board_id: "board-a",
  group_id: "group-a",
  title: "대한정밀",
  assigned_to: null,
  deal_id: "deal-a",
  sort_order: 0,
  created_at: "2026-08-26T00:00:00Z",
  updated_at: "2026-08-26T00:00:00Z",
  values: { phone: "01012345678", delay_notice: "2026-08-26 14:30" },
} as never;

describe("Issue #560 compact new-lead message cell", () => {
  it("닫힌 셀은 1행 트리거에 선택 문구와 최근 발송 상태만 요약한다", () => {
    const html = renderToStaticMarkup(<NewLeadMessageCell row={row} />);

    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain("h-7");
    expect(html).toContain("whitespace-nowrap");
    expect(html).toContain("상담지연");
    expect(html).toContain("2026-08-26 14:30");
    expect(html).not.toContain("<select");
    expect(html).not.toContain('href="/settings/automations#solapi"');
  });

  it("보내기와 설정은 표 바깥 포털 드롭다운 안에만 둔다", () => {
    const source = readFileSync(new URL("./NewLeadMessageCell.tsx", import.meta.url), "utf8");
    const portalStart = source.indexOf('createPortal(');
    const portalEnd = source.indexOf('document.body,', portalStart);
    const menuSource = source.slice(portalStart, portalEnd);

    expect(portalStart).toBeGreaterThan(-1);
    expect(portalEnd).toBeGreaterThan(portalStart);
    expect(menuSource).toContain('role="menu"');
    expect(menuSource).toContain('role="menuitemradio"');
    expect(menuSource).toContain('>\n                설정\n              </Link>');
    expect(menuSource).toContain('>\n                보내기\n              </button>');
  });
});
