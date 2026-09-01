// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ORG_VIEWS, type OrgViewModel } from "@/lib/org/org-view";
import { OrgViewTabs } from "./OrgViewTabs";

const DEPARTMENT_ID = "d0000000-0000-4000-8000-000000000001";

const model: OrgViewModel = {
  departments: [{
    id: DEPARTMENT_ID,
    name: "1팀",
    parentId: null,
    headUserId: "head",
    sortOrder: 0,
    memberCount: 2,
    depth: 0,
    reachCount: 2,
  }],
  members: [
    {
      userId: "head",
      displayName: "가상 팀장",
      title: "팀장",
      titleKnown: true,
      departmentIds: [DEPARTMENT_ID],
      primaryDepartmentId: DEPARTMENT_ID,
      primaryDepartmentName: "1팀",
      role: "admin",
      scope: "all",
      reportsToUserId: "owner",
      reportsToName: "가상 대표",
      isHeadOfPrimary: true,
      active: true,
    },
    {
      userId: "member",
      displayName: "가상 구성원",
      title: null,
      titleKnown: true,
      departmentIds: [DEPARTMENT_ID],
      primaryDepartmentId: DEPARTMENT_ID,
      primaryDepartmentName: "1팀",
      role: "member",
      scope: "assigned",
      reportsToUserId: "head",
      reportsToName: "가상 팀장",
      isHeadOfPrimary: false,
      active: true,
    },
  ],
  unassignedCount: 0,
  reportingKnown: true,
};

let root: Root | null = null;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

async function renderFixture() {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <OrgViewTabs
        model={model}
        departmentSlot={<div>부서 관리</div>}
        permissionSlot={<div>권한 관리</div>}
      />,
    );
  });
  return host;
}

const press = async (element: HTMLElement, key: string) => {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
};

describe("Issue #643 조직관리 갈래 접근성", () => {
  it("tab과 현재 tabpanel을 exact id로 연결하고 선택된 갈래만 tab stop으로 둔다", async () => {
    const host = await renderFixture();
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs).toHaveLength(ORG_VIEWS.length);
    expect(tabs.map((tab) => [tab.id, tab.getAttribute("aria-controls"), tab.tabIndex])).toEqual(
      ORG_VIEWS.map((key) => [
        `org-view-tab-${key}`,
        `org-view-panel-${key}`,
        key === "list" ? 0 : -1,
      ]),
    );
    expect(host.querySelectorAll('[role="tabpanel"]')).toHaveLength(ORG_VIEWS.length);
    const panel = host.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])');
    expect(panel?.id).toBe("org-view-panel-list");
    expect(panel?.getAttribute("aria-labelledby")).toBe("org-view-tab-list");
  });

  it("화살표·Home·End가 선택과 포커스를 함께 옮기고 끝에서 순환한다", async () => {
    const host = await renderFixture();
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const listIndex = ORG_VIEWS.indexOf("list");
    const chartIndex = ORG_VIEWS.indexOf("chart");
    const firstIndex = 0;
    const lastIndex = ORG_VIEWS.length - 1;
    tabs[listIndex].focus();

    await press(tabs[listIndex], "ArrowRight");
    expect(document.activeElement).toBe(tabs[chartIndex]);
    expect(tabs[chartIndex].getAttribute("aria-selected")).toBe("true");
    expect(host.querySelector('[role="tabpanel"]:not([hidden])')?.id).toBe("org-view-panel-chart");

    await press(tabs[chartIndex], "End");
    expect(document.activeElement).toBe(tabs[lastIndex]);
    expect(tabs[lastIndex].getAttribute("aria-selected")).toBe("true");

    await press(tabs[lastIndex], "Home");
    expect(document.activeElement).toBe(tabs[firstIndex]);
    expect(tabs[firstIndex].getAttribute("aria-selected")).toBe("true");
    expect(host.querySelector('[role="tabpanel"]:not([hidden])')?.id).toBe("org-view-panel-seats");

    await press(tabs[firstIndex], "ArrowLeft");
    expect(document.activeElement).toBe(tabs[lastIndex]);
    expect(tabs[lastIndex].getAttribute("aria-selected")).toBe("true");
    expect(tabs.filter((tab) => tab.tabIndex === 0)).toEqual([tabs[lastIndex]]);
  });

  it("선택한 부서는 사람 이름으로만 말하고 raw dept UUID를 화면에 그리지 않는다", async () => {
    const host = await renderFixture();
    const department = host.querySelector<HTMLButtonElement>(`[data-department-id="${DEPARTMENT_ID}"]`);
    await act(async () => department?.click());
    expect(host.textContent).toContain("선택한 부서: 1팀");
    expect(host.textContent).not.toContain("dept:");
    expect(host.textContent).not.toContain(DEPARTMENT_ID);
  });

  it("보고 대상 이름에 붙던 모호한 상위 꼬리표 대신 현재 조직원이 책임자임을 말한다", async () => {
    const host = await renderFixture();
    expect(host.textContent).toContain("이 조직원은 부서 책임자");
    expect(host.textContent).not.toContain("(상위)");
  });

  it("375px 가로 이동 힌트를 tablist에 설명으로 연결한다", async () => {
    const host = await renderFixture();
    const hint = host.querySelector<HTMLElement>("[data-org-view-scroll-hint]");
    expect(hint?.textContent).toContain("갈래를 옆으로 밀어 더 볼 수 있어요");
    expect(host.querySelector('[role="tablist"]')?.getAttribute("aria-describedby")).toBe(hint?.id);
  });
});
