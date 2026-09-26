// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompaniesBulkBar } from "./CompaniesBulkBar";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { bulkReassignMock } = vi.hoisted(() => ({ bulkReassignMock: vi.fn() }));

vi.mock("@/app/(app)/(tabs)/companies/bulk-actions", () => ({
  authorizeCompaniesCsvExport: vi.fn(async () => ({ ok: true })),
  bulkReassignDealsAction: bulkReassignMock,
  bulkStartWorkAction: vi.fn(async () => ({ ok: true, applied: 0, failed: 0, results: [] })),
  bulkUpdateCompaniesAction: vi.fn(async () => ({ ok: true, applied: 0, failed: 0, results: [] })),
  bulkUpdateDealsAction: vi.fn(async () => ({ ok: true, applied: 0, failed: 0, results: [] })),
}));

afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});

const dealTargets = [{ bulkId: "deal:d1", kind: "deal" as const, id: "d1", title: "운전자금" }];

function barProps(extra: Record<string, unknown> = {}) {
  return {
    totalSelected: 1,
    targets: dealTargets,
    members: [],
    exportCsv: "a",
    exportFilename: "x.csv",
    dialog: "assignee" as const,
    notice: null,
    onOpenDialog: () => {},
    onCloseDialog: () => {},
    onClear: () => {},
    onApplied: () => {},
    onNotice: () => {},
    ...extra,
  };
}

function applyButton(host: HTMLElement): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("담당자 적용"),
  );
  if (!found) throw new Error("apply button missing");
  return found as HTMLButtonElement;
}

describe("AssigneeDialog 멤버 조회 상태", () => {
  it("조회 실패는 실제 오류·다시 시도를 보이고 ID 직접입력을 노출하지 않는다", async () => {
    const onRetry = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <CompaniesBulkBar
          {...barProps({ membersError: "담당자 목록을 불러오지 못했습니다.", onRetryMembers: onRetry })}
        />,
      );
    });
    expect(host.querySelector('[aria-label="담당자 ID 직접 입력"]')).toBeNull();
    expect(host.textContent).toContain("담당자 목록을 불러오지 못했습니다.");
    const retry = [...host.querySelectorAll("button")].find((button) => button.textContent === "다시 시도");
    expect(retry).toBeTruthy();
    await act(async () => {
      retry!.click();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    // 담당 변경만 차단 — 적용 버튼이 막히고 호출이 나가지 않는다.
    expect(applyButton(host).disabled).toBe(true);
    await act(async () => {
      applyButton(host).click();
    });
    expect(bulkReassignMock).not.toHaveBeenCalled();
    await act(async () => {
      root.unmount();
    });
  });

  it("빈 목록은 조회 장애와 구분되고 ID 직접입력 없이 안내만 한다", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<CompaniesBulkBar {...barProps({ members: [] })} />);
    });
    expect(host.querySelector('[aria-label="담당자 ID 직접 입력"]')).toBeNull();
    expect(host.textContent).toContain("선택할 수 있는 회사 멤버가 없습니다");
    expect(applyButton(host).disabled).toBe(true);
    await act(async () => {
      root.unmount();
    });
  });

  it("정상 로드된 회사 멤버만 선택할 수 있다", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <CompaniesBulkBar {...barProps({ members: [{ id: "user-1", label: "담당A" }] })} />,
      );
    });
    expect(host.querySelector('[aria-label="담당자 ID 직접 입력"]')).toBeNull();
    const select = host.querySelector('select[aria-label="일괄 적용할 담당자"]');
    expect(select?.textContent).toContain("담당A");
    await act(async () => {
      root.unmount();
    });
  });

  it("조회 실패해도 영향 없는 작업 버튼은 그대로 둔다", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <CompaniesBulkBar {...barProps({ membersError: "담당자 목록을 불러오지 못했습니다." })} />,
      );
    });
    // 자금 필드·내보내기·선택 해제는 그대로 노출된다.
    const labels = [...host.querySelectorAll("button")].map((button) => button.textContent);
    expect(labels.some((label) => label?.includes("자금 필드"))).toBe(true);
    expect(labels.some((label) => label?.includes("내보내기"))).toBe(true);
    expect(labels.some((label) => label?.includes("선택 해제"))).toBe(true);
    await act(async () => {
      root.unmount();
    });
  });
});
