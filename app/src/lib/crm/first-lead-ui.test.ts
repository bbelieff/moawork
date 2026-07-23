import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

const page = read("../../app/(app)/newcust/page.tsx");
const action = read("../../app/(app)/newcust/actions.ts");
const form = read("../../components/crm/NewLeadForm.tsx");
const nav = read("../../components/shell/nav-items.ts");

describe("/newcust first lead UI contract", () => {
  it("조회와 쓰기가 요청별 server source 정책을 사용한다", () => {
    expect(page).toContain("await getServerCrmSource()");
    expect(page).toContain("loadStageBoard(ctx, board, source)");
    expect(action).toContain("await getServerCrmSource()");
    expect(action).toContain("await createClient()");
  });

  it("생성 후 경로를 revalidate하고 created 상태로 redirect한다", () => {
    expect(action).toContain('revalidatePath("/newcust")');
    expect(action).toContain("/newcust?created=1&deal=");
    expect(page).toContain('created={sp.created === "1"}');
  });

  it("접근 가능한 label·오류 alert·성공 status를 제공한다", () => {
    expect(form).toContain("<label");
    expect(form).toContain('name="companyName"');
    expect(form).toContain("required");
    expect(form).toContain('role="alert"');
    expect(form).toContain('role="status"');
  });

  it("신규업체 메뉴를 실제 /newcust 경로로 연결한다", () => {
    expect(nav).toContain(
      'key: "new", label: "신규업체", icon: "🔥", href: "/newcust"',
    );
  });
});
