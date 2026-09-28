// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { DetailFieldSubmit } from "./ItemDetailPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("상세 전용 필드 추가 버튼 (#654)", () => {
  let host: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    host?.remove();
    host = null;
    root = null;
  });

  it("저장이 끝날 때까지 다시 못 누르고, 누른 것이 보인다", async () => {
    let finish: () => void = () => {};
    let calls = 0;
    const action = async () => {
      calls += 1;
      await new Promise<void>((resolve) => { finish = resolve; });
    };
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(
        <form action={action}>
          <input name="label" defaultValue="법인공동인증서" />
          <DetailFieldSubmit idle="추가" />
        </form>,
      );
    });
    const button = host.querySelector("button")!;
    expect(button.textContent).toBe("추가");
    expect(button.disabled).toBe(false);

    await act(async () => { button.click(); });
    expect(button.disabled, "저장 중인데 다시 누를 수 있다").toBe(true);
    expect(button.textContent).toBe("추가하는 중…");
    expect(button.getAttribute("aria-busy")).toBe("true");

    await act(async () => { button.click(); });
    expect(calls, "저장 중에 한 번 더 제출됐다").toBe(1);

    await act(async () => { finish(); });
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("추가");
  });
});
