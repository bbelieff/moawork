// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/app/(app)/boards/new-lead-actions", () => ({ createNewLeadAction: vi.fn() }));
import { createNewLeadAction } from "@/app/(app)/boards/new-lead-actions";
import { NewLeadIntakeForm } from "./NewLeadIntakeForm";
let root: Root | null = null;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { vi.clearAllMocks(); HTMLElement.prototype.scrollIntoView = vi.fn(); });
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = null; document.body.replaceChildren(); });
async function open(variant: "inline" | "header" = "inline") {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(<NewLeadIntakeForm variant={variant} boardId="board-a" groupId="group-a" members={[{id:"user-a",label:"담당자 A"},{id:"user-b",label:"담당자 B"}]} currentUserId="user-a" />));
  expect(host.querySelector("form")).toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(dialog.parentElement).toBe(document.body);
  return dialog.querySelector<HTMLFormElement>("form")!;
}
async function set(form: HTMLFormElement, name: string, value: string) {
  const control = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype,"value")!.set!.call(control,value);
    control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? "change" : "input",{bubbles:true}));
  });
}
describe("등록 실패 시 입력 유지", () => {
  it.each(["inline", "header"] as const)("%s 등록은 팝업이고 검증 실패·재시도에 모든 입력과 요청 ID를 유지한다", async variant => {
    vi.mocked(createNewLeadAction).mockResolvedValue({ok:false,field:"region_sigungu",message:"시군구를 추천 목록에서 선택해 주세요."});
    const form = await open(variant);
    await set(form,"title","입력 보존 검증"); await set(form,"business_registration_type","법인사업자");
    await set(form,"phone","01012345678"); await set(form,"representative_name","담당자");
    await set(form,"email","draft@example.invalid"); await set(form,"industry","제조");
    await set(form,"region_sido","서울"); await set(form,"region_sigungu","없는 지역");
    await set(form,"revenue_band","그외"); await set(form,"revenue_band_custom","2억 5천만원");
    await set(form,"address_detail","상세 주소"); await set(form,"acquisition_source","직접 문의");
    await act(async()=>{ form.querySelector<HTMLInputElement>('[name="assigned_to"][value="user-b"]')!.click(); form.querySelector<HTMLInputElement>('[name="collaborator_ids"][value="user-a"]')!.click(); });
    const before=[...new FormData(form).entries()];
    await act(async()=>form.requestSubmit());
    expect([...new FormData(form).entries()]).toEqual(before);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("시군구");
    expect(document.activeElement).toBe(form.elements.namedItem("region_sigungu"));
    expect((document.activeElement as HTMLElement).getAttribute("aria-invalid")).toBe("true");
    vi.mocked(createNewLeadAction).mockResolvedValue({ok:false,field:"title",message:"회사명을 확인해 주세요."});
    await act(async()=>form.requestSubmit());
    expect((form.elements.namedItem("region_sigungu") as HTMLElement).getAttribute("aria-invalid")).toBe("false");
    expect((form.elements.namedItem("region_sigungu") as HTMLElement).hasAttribute("aria-describedby")).toBe(false);
    await set(form,"region_sigungu","강남구");
    vi.mocked(createNewLeadAction).mockResolvedValue({ok:true,message:"등록했습니다."});
    await act(async()=>form.requestSubmit());
    expect(createNewLeadAction).toHaveBeenCalledTimes(3);
    const first=vi.mocked(createNewLeadAction).mock.calls[0][1]; const retry=vi.mocked(createNewLeadAction).mock.calls[2][1];
    expect(retry.get("requestId")).toBe(first.get("requestId"));
    expect(retry.get("title")).toBe("입력 보존 검증"); expect(retry.get("region_sigungu")).toBe("강남구");
    await act(async()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("네트워크 예외에도 팝업과 입력을 유지하고 재시도 안내를 보여준다",async()=>{
    vi.mocked(createNewLeadAction).mockRejectedValue(new Error("network"));
    const form=await open(); await set(form,"title","남겨둘 입력");
    await act(async()=>form.requestSubmit());
    expect(new FormData(form).get("title")).toBe("남겨둘 입력");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("다시 등록");
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });
});
