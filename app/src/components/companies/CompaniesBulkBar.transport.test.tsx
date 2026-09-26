// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompaniesBulkBar, type CompaniesBulkOp } from "./CompaniesBulkBar";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const actions = vi.hoisted(() => ({ company: vi.fn(), deal: vi.fn(), assignee: vi.fn(), work: vi.fn() }));
vi.mock("@/app/(app)/(tabs)/companies/bulk-actions", () => ({
  authorizeCompaniesCsvExport: vi.fn(),
  bulkUpdateCompaniesAction: actions.company,
  bulkUpdateDealsAction: actions.deal,
  bulkReassignDealsAction: actions.assignee,
  bulkStartWorkAction: actions.work,
}));
afterEach(() => { document.body.replaceChildren(); vi.clearAllMocks(); });

function fixture(dialog: CompaniesBulkOp, id: string) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const kind = dialog === "company-fields" || dialog === "work-start" ? "company" : "deal";
  const props: ComponentProps<typeof CompaniesBulkBar> = {
    totalSelected: 1, targets: [{ bulkId: `${kind}:${id}`, kind, id, title: "검토 대상" }],
    members: [{ id: "member-1", label: "담당자" }], exportCsv: "", exportFilename: "test.csv",
    dialog, notice: null, onOpenDialog: vi.fn(), onCloseDialog: vi.fn(), onClear: vi.fn(),
    onApplied: vi.fn(), onNotice: vi.fn(),
  };
  return { host, root, props };
}
function submit(host: HTMLElement) {
  const button = [...host.querySelectorAll<HTMLButtonElement>("dialog button")].find(
    (entry) => /1개 .*적용|1개 업무 시작|적용 중|시작 중/.test(entry.textContent ?? ""),
  );
  if (!button) throw new Error("submit missing");
  return button;
}
function fill(host: HTMLElement, dialog: CompaniesBulkOp) {
  if (dialog === "work-start") return;
  if (dialog === "assignee") {
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="일괄 적용할 담당자"]')!;
    select.value = "member-1";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    const input = host.querySelector<HTMLInputElement>('input[aria-label="일괄 적용할 값"]')!;
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, "보존할 입력");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

describe("회사 bulk 응답 유실", () => {
  it.each([
    ["company-fields", "company"], ["deal-fields", "deal"], ["assignee", "assignee"], ["work-start", "work"],
  ] as const)("%s keeps draft/selection and blocks retry across reopen", async (dialog, actionKey) => {
    const action = actions[actionKey];
    action.mockRejectedValueOnce(new Error("응답 연결 끊김"));
    const { host, root, props } = fixture(dialog, `lost-${dialog}`);
    await act(async () => { root.render(<CompaniesBulkBar {...props} />); });
    await act(async () => { fill(host, dialog); });
    await act(async () => { submit(host).click(); });
    expect(action).toHaveBeenCalledTimes(1);
    expect(host.querySelector("dialog")).not.toBeNull();
    expect(props.onCloseDialog).not.toHaveBeenCalled();
    expect(props.onApplied).not.toHaveBeenCalled();
    expect(props.onNotice).not.toHaveBeenCalled();
    expect(host.textContent).toContain("응답 연결 끊김");
    expect(host.textContent).toContain("일부 또는 전부 적용됐을 수 있습니다");
    expect(host.textContent).toContain("새로고침하여 확인");
    expect(host.textContent).not.toContain("저장하지 못한");
    if (dialog === "assignee") expect(host.querySelector<HTMLSelectElement>('select[aria-label="일괄 적용할 담당자"]')!.value).toBe("member-1");
    else if (dialog !== "work-start") expect(host.querySelector<HTMLInputElement>("input")!.value).toBe("보존할 입력");
    expect(submit(host).disabled).toBe(true);
    await act(async () => { submit(host).click(); });
    await act(async () => { root.render(<CompaniesBulkBar {...props} dialog={null} />); });
    await act(async () => { root.render(<CompaniesBulkBar {...props} />); });
    expect(submit(host).disabled).toBe(true);
    await act(async () => { submit(host).click(); });
    expect(action).toHaveBeenCalledTimes(1);
    await act(async () => { root.unmount(); });
  });

  it("업무 시작 pending도 재열기 중 중복 호출을 막고 확정 성공만 적용한다", async () => {
    let resolve!: (value: unknown) => void;
    actions.work.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const { host, root, props } = fixture("work-start", "pending-work");
    await act(async () => { root.render(<CompaniesBulkBar {...props} />); });
    await act(async () => { submit(host).click(); submit(host).click(); });
    expect(actions.work).toHaveBeenCalledTimes(1);
    await act(async () => { root.render(<CompaniesBulkBar {...props} dialog={null} />); });
    await act(async () => { root.render(<CompaniesBulkBar {...props} />); });
    expect(submit(host).disabled).toBe(true);
    await act(async () => { submit(host).click(); });
    expect(actions.work).toHaveBeenCalledTimes(1);
    await act(async () => { resolve({ ok: true, applied: 1, failed: 0, results: [{ itemId: "pending-work", ok: true, message: "완료" }] }); });
    expect(props.onApplied).toHaveBeenCalledWith(["company:pending-work"]);
    expect(props.onCloseDialog).toHaveBeenCalledTimes(1);
    await act(async () => { root.unmount(); });
  });

  it("서버가 확정 거부한 결과는 입력과 재시도를 유지한다", async () => {
    actions.company.mockResolvedValueOnce({ ok: false, applied: 0, failed: 1, results: [{ itemId: "rejected", ok: false, message: "필드 오류" }] });
    const { host, root, props } = fixture("company-fields", "rejected");
    await act(async () => { root.render(<CompaniesBulkBar {...props} />); });
    await act(async () => { fill(host, "company-fields"); });
    await act(async () => { submit(host).click(); });
    expect(submit(host).disabled).toBe(false);
    expect(host.textContent).toContain("필드 오류");
    expect(host.textContent).not.toContain("일부 또는 전부 적용됐을 수 있습니다");
    expect(host.querySelector<HTMLInputElement>("input")!.value).toBe("보존할 입력");
    expect(props.onCloseDialog).not.toHaveBeenCalled();
    await act(async () => { root.unmount(); });
  });
});
