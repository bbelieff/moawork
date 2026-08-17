import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { OrgLogoCard } from "./OrgLogoCard";

const render = (props: Parameters<typeof OrgLogoCard>[0]) => renderToStaticMarkup(<OrgLogoCard {...props} />);

describe("OrgLogoCard", () => {
  it("★ owner/admin 에게 업로드 입력을 보여준다", () => {
    const html = render({ orgName: "샘플 회사", logo: { kind: "none" }, canManage: true });
    expect(html).toContain('type="file"');
    expect(html).toContain("로고 올리기");
    expect(html).toContain('accept="image/png,image/jpeg,image/svg+xml"');
    expect(html).not.toContain('data-org-logo-locked="true"');
  });

  it("★ 권한이 없으면 입력을 감추고 «사유» 를 보여준다 — 말없이 사라지지 않는다", () => {
    const html = render({ orgName: "샘플 회사", logo: { kind: "none" }, canManage: false });
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain("로고 올리기");
    expect(html).toContain('data-org-logo-locked="true"');
    expect(html).toContain("대표와 관리자만");
  });

  it("★ 로고가 없으면 이니셜을 보여준다 — 빈칸을 만들지 않는다", () => {
    const html = render({ orgName: "샘플 회사", logo: { kind: "none" }, canManage: true });
    expect(html).not.toContain("<img");
    expect(html).toContain("샘");
    expect(html).toContain('data-org-logo-status="none"');
  });

  it("로고가 있으면 미리보기와 지우기를 함께 보여준다", () => {
    const html = render({
      orgName: "샘플 회사",
      logo: { kind: "ready", signedUrl: "https://storage.example.invalid/s/logo.png" },
      canManage: true,
    });
    expect(html).toContain("https://storage.example.invalid/s/logo.png");
    expect(html).toContain("로고 지우기");
    expect(html).toContain('data-org-logo-status="ready"');
  });

  it("권한이 없으면 로고가 있어도 지우기 버튼이 없다", () => {
    const html = render({
      orgName: "샘플 회사",
      logo: { kind: "ready", signedUrl: "https://storage.example.invalid/s/logo.png" },
      canManage: false,
    });
    expect(html).toContain("https://storage.example.invalid/s/logo.png");
    expect(html).not.toContain("로고 지우기");
  });

  it("★ 「아직 없음」과 「불러오지 못함」을 다르게 말한다", () => {
    const none = render({ orgName: "샘플 회사", logo: { kind: "none" }, canManage: true });
    const broken = render({ orgName: "샘플 회사", logo: { kind: "unavailable" }, canManage: true });
    expect(none).toContain('data-org-logo-status="none"');
    expect(broken).toContain('data-org-logo-status="unavailable"');
    expect(broken).toContain("불러오지 못했어요");
    // 둘 다 이니셜로 떨어지지만, 사용자에게 하는 말은 달라야 한다.
    expect(none).not.toContain("불러오지 못했어요");
    expect(broken).toContain("샘");
  });

  it("올릴 수 있는 형식과 용량을 화면에 적어 둔다", () => {
    const html = render({ orgName: "샘플 회사", logo: { kind: "none" }, canManage: true });
    expect(html).toContain("PNG · JPG · SVG · 1MB 이하");
  });
});
