// @vitest-environment jsdom
// 2026-10-08 — 끄는 중의 컬럼 폭은 보드별 모듈 저장소에 있다. 그 보드의 표가 모두 내려가면(보드를 떠나면)
// 버려져, 다시 들어왔을 때 저장된 폭이 옛 끄는 값에 가려지지 않는다.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { resetLiveColumnWidthsForTest, useLiveColumnWidths } from "./column-live-width";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => resetLiveColumnWidthsForTest());

function Probe({ boardId }: { boardId: string }) {
  const { widths, set } = useLiveColumnWidths(boardId);
  return <button type="button" data-width={widths["c1"] ?? ""} onClick={() => set("c1", 300)} />;
}

describe("useLiveColumnWidths", () => {
  it("같은 보드의 표들이 끄는 값을 같이 보고, 마지막 표가 내려가면 값을 버린다", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(<><Probe boardId="b1" /><Probe boardId="b1" /></>));
    await act(async () => host.querySelector("button")!.click());
    expect([...host.querySelectorAll("button")].map((node) => node.getAttribute("data-width"))).toEqual(["300", "300"]);
    await act(async () => root.render(<Probe boardId="b1" />));
    expect(host.querySelector("button")!.getAttribute("data-width")).toBe("300");
    await act(async () => root.unmount());
    const again = createRoot(host);
    await act(async () => again.render(<Probe boardId="b1" />));
    expect(host.querySelector("button")!.getAttribute("data-width")).toBe("");
    await act(async () => again.unmount());
  });
});
