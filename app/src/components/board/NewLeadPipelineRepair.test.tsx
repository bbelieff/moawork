// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
const { action } = vi.hoisted(() => ({ action: vi.fn() }));
vi.mock("@/app/(app)/boards/pipeline-structure-actions", () => ({ pipelineStructureAction: action }));
import { NewLeadPipelineRepair } from "./NewLeadPipelineRepair";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
afterEach(async () => { await act(async () => root?.unmount()); document.body.replaceChildren(); action.mockReset(); });
async function mount() {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<NewLeadPipelineRepair itemId="item-a" />));
}
async function click() { await act(async () => host.querySelector("button")!.click()); }
describe("explicit pipeline repair", () => {
  it("shows the pipeline and only missing kinds before explicit apply; preserves preview identity", async () => {
    action.mockResolvedValueOnce({ok:true,message:"확인",pipelineId:"pipeline-a",pipelineName:"사용자 파이프라인",missing:["work"]})
      .mockResolvedValueOnce({ok:true,message:"단계 구성을 확인했습니다. 비대면 상담으로 넘기기를 다시 실행해 주세요.",pipelineId:"pipeline-a",missing:[]});
    await mount(); expect(action).not.toHaveBeenCalled();
    await click(); expect(action).toHaveBeenLastCalledWith({itemId:"item-a",apply:false,pipelineId:undefined,missing:undefined});
    expect(host.textContent).toContain("사용자 파이프라인 · 추가: 실무");
    await click(); expect(action).toHaveBeenLastCalledWith({itemId:"item-a",apply:true,pipelineId:"pipeline-a",missing:["work"]});
    expect(host.querySelector('[role="status"]')?.textContent).toContain("다시 실행");
  });
  it("lost response removes the apply option and requires a fresh preview", async () => {
    action.mockResolvedValueOnce({ok:true,message:"확인",pipelineId:"p",pipelineName:"기본",missing:["meeting","work"]})
      .mockRejectedValueOnce(new Error("transport"))
      .mockResolvedValueOnce({ok:true,message:"완료",pipelineId:"p",missing:[]});
    await mount(); await click(); await click();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("결과를 확인하지 못했습니다");
    expect(host.textContent).not.toContain("기본 상담·실무 단계 추가");
    await click(); expect(action).toHaveBeenLastCalledWith({itemId:"item-a",apply:false,pipelineId:undefined,missing:undefined});
  });
  it("denied preview offers no mutation button", async () => {
    action.mockResolvedValue({ok:false,message:"관리자만 복구할 수 있습니다."});
    await mount(); await click();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.textContent).not.toContain("기본 상담·실무 단계 추가");
  });
});
