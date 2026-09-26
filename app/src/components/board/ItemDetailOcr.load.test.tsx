// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/app/(app)/boards/ocr-actions", () => ({ loadOcrCurrentAction: mocks.load, saveOcrFieldAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/document-ocr/DocumentOcrModal", () => ({ DocumentOcrModal: () => <div role="dialog">OCR 비교</div> }));
import { ItemDetailOcr } from "./ItemDetailOcr";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("transport rejection shows a sanitized error, keeps the modal closed, and permits retry", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  mocks.load.mockRejectedValueOnce(new Error("private connection detail"));
  mocks.load.mockResolvedValueOnce({ ok: true, current: { title: "합성 회사", bizNo: "", birthdate: "", businessItem: "", linkedCompany: false, linkedCompanyName: "" } });
  try {
    await act(async () => root.render(<ItemDetailOcr boardId="board" itemId="item" values={{}} columns={[]} boardLayout={[]} layout={[]} canEditItems />));
    const button = host.querySelector("button")!;
    await act(async () => button.click());
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("비교 기준을 읽지 못했어요");
    expect(alert?.getAttribute("aria-live")).toBe("assertive");
    expect(host.textContent).not.toContain("private connection detail");
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
