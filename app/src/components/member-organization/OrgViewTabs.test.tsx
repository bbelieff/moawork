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

/*
 * ★ «공석» 이 화면에 «실제로» 뜨는지 — 배선 시험이다.
 *
 * 이 저장소가 반복하는 병은 「부품은 다 만들어 놓고 배선을 안 한다」이고,
 * 이 화면은 그 병을 이미 두 번 앓았다(#640 · #683). 세 번째가 여기서 날 뻔했다 —
 * deriveSeats 의 기본값을 바꾸면서 화면이 «사람 없는 자리» 를 만들 길을 통째로 잃었고,
 * 그러면 붉은 「공석」도 앰버 「모름」도 영원히 안 뜨는 죽은 코드가 된다.
 *
 * 순수 함수 시험(seats.test.ts)은 인자를 «우리가» 넣어서 부르므로 이걸 못 잡는다.
 * 화면을 실제로 그려서 배지가 나오는지 봐야 한다.
 */
describe("#683 공석이 화면에 실제로 뜬다", () => {
  const withDefinition = async (seatKey: { departmentId: string | null; role: "team_lead" }) => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <OrgViewTabs
          model={model}
          initialView="seats"
          departmentSlot={<div>부서 관리</div>}
          permissionSlot={<div>권한 관리</div>}
          seatDefinitions={
            new Map([
              [
                `${seatKey.departmentId ?? "-"}:${seatKey.role}`,
                {
                  departmentId: seatKey.departmentId,
                  role: seatKey.role,
                  summary: "리드를 3일 안에 첫 통화까지",
                  duties: [],
                  escalate: [],
                  handle: [],
                  avoid: [],
                  signals: null,
                  handover: null,
                  updatedAt: null,
                  updatedById: null,
                  updatedByName: null,
                },
              ],
            ])
          }
        />,
      );
    });
    return host;
  };

  it("★ 「하는 일」이 적혀 있으면 사람이 없어도 그 자리가 남고 「공석」이 뜬다", async () => {
    // 픽스처에 team_lead 인 사람은 없다 — 팀장이 나간 회사와 같은 모양이다.
    const host = await withDefinition({ departmentId: DEPARTMENT_ID, role: "team_lead" });

    expect(host.querySelector("[data-seat-vacant]")).not.toBeNull();
    expect(host.textContent).toContain("공석");
    expect(host.textContent).toContain("1팀 팀장");
  });

  it("★ 적어 둔 자리가 «아직 없으면» 없는 공석을 만들지 않는다 — 세 명 회사가 겪던 것", async () => {
    /*
     * ★ 빈 Map 을 «명시적으로» 넘긴다. renderFixture 는 prop 을 안 넘겨서 기본값 null 이 되는데
     *   그건 «아직 없음» 이 아니라 «못 읽음» 이다. 그걸로 재면 «못 읽음이 공석 0을 낸다» 를
     *   기대값으로 굳히게 된다 — 이 PR 이 내내 반대하던 «읽기 실패를 사실로 단언» 그 자체다.
     */
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <OrgViewTabs
          model={model}
          initialView="seats"
          departmentSlot={<div>부서 관리</div>}
          permissionSlot={<div>권한 관리</div>}
          seatDefinitions={new Map()}
        />,
      );
    });

    // 머리말은 「공석 N」을 항상 그리므로 «배지» 와 «숫자» 로 잰다. 글자만 세면 늘 통과한다.
    expect(host.querySelector("[data-seat-vacant]")).toBeNull();
    expect(host.textContent).toContain("공석 0");
  });

  it("★ 자리 목록을 «못 읽었으면» 「공석 0」이라고 단언하지 않는다", async () => {
    /*
     * seatDefinitions 가 null 이면 «어떤 자리가 선언돼 있는지» 를 우리가 모른다.
     * 그때 「공석 0」만 덩그러니 보여주면 화면이 없는 사실을 단언하는 것이다 —
     * 「하는 일」 칸이 이미 「불러오지 못했어요. 비어 있다는 뜻은 아니에요」라고 말하는데,
     * 자리가 아예 안 뜨면 그 문장에 **도달할 수조차 없다.**
     */
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <OrgViewTabs
          model={model}
          initialView="seats"
          departmentSlot={<div>부서 관리</div>}
          permissionSlot={<div>권한 관리</div>}
          seatDefinitions={null}
        />,
      );
    });

    expect(host.querySelector("[data-seats-unknown]")).not.toBeNull();
    expect(host.textContent).toContain("다 못 읽었어요");

    /*
     * ★ 머리말도 «숫자를 단언하지 않는다». 배너는 목록 아래라서 머리말만 훑는 사람은 못 본다.
     *   그리고 「?」가 아니라 「모름」이다 — 이 화면은 이미 그 말로 «모른다» 를 적는다.
     *   기호를 섞으면 「공석 ? · 모르는 자리 2」처럼 한 개념에 표기가 둘이 된다.
     */
    expect(host.textContent).toContain("공석 모름");
    expect(host.textContent).not.toContain("공석 0");
  });
});
