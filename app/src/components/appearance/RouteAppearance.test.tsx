// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouteAppearance } from "./RouteAppearance";

const location = vi.hoisted(() => ({ pathname: "/boards/contact-board", search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => location.pathname,
  useSearchParams: () => new URLSearchParams(location.search),
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const boardNavKeys = { "contact-board": "contact", "work-board": "work" };
let root: Root | undefined;

async function navigate(pathname: string, search = "", basePath?: string) {
  location.pathname = pathname;
  location.search = search;
  if (!root) {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  }
  await act(async () => { root!.render(<RouteAppearance basePath={basePath} boardNavKeys={boardNavKeys} />); });
  return document.documentElement.getAttribute("data-mw-accent");
}
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = undefined;
  document.body.replaceChildren();
});

describe("상담 경로 및 쿼리의 반응형 외관", () => {
  it.each(["", "/w/sample-lab"])("%s 보드의 쿼리만 바뀌어도 STEP 색을 갱신한다", async (basePath) => {
    const path = `${basePath}/boards/contact-board`;
    expect(await navigate(path, "consultation=remote", basePath)).toBe("contact");
    expect(await navigate(path, "consultation=inperson", basePath)).toBe("inperson");
    expect(await navigate(path, "consultation=remote", basePath)).toBe("contact");
    expect(await navigate(path, "consultation=unknown", basePath)).toBe("contact");
    expect(await navigate(path, "", basePath)).toBe("contact");
  });

  it.each(["", "/w/sample-lab"])("%s 상담 진입 주소와 리다이렉트된 보드가 같은 색이다", async (basePath) => {
    expect(await navigate(`${basePath}/consult-inperson`, "", basePath)).toBe("inperson");
    expect(await navigate(`${basePath}/boards/contact-board`, "consultation=inperson", basePath)).toBe("inperson");
    expect(await navigate(`${basePath}/consult-remote`, "", basePath)).toBe("contact");
  });

  it("다른 보드의 상담 쿼리를 무시하고 기존 경로 및 unknown 폴백을 유지한다", async () => {
    const base = "/w/sample-lab";
    expect(await navigate(`${base}/boards/work-board`, "consultation=inperson", base)).toBe("work");
    expect(await navigate(`${base}/boards/unknown`, "consultation=inperson", base)).toBe("dash");
    expect(await navigate(`${base}/companies`, "consultation=inperson", base)).toBe("company");
    expect(await navigate(`${base}/newcust`, "", base)).toBe("new");
  });

  it("언마운트에서 경로 강조를 제거한다", async () => {
    await navigate("/consult-inperson");
    await act(async () => { root!.unmount(); });
    root = undefined;
    expect(document.documentElement.hasAttribute("data-mw-accent")).toBe(false);
  });
});
