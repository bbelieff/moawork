// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RegionCell } from "./RegionPairCell";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { boardActionMock } = vi.hoisted(() => ({ boardActionMock: vi.fn() }));

vi.mock("@/app/(app)/boards/region-pair-actions", () => ({
  updateNewLeadRegionPairAction: vi.fn(async () => ({ ok: true, message: "✓ 자동 저장됨" })),
  updateBoardRegionPairAction: boardActionMock,
}));

let boardSequence = 0;
beforeEach(() => { boardSequence += 1; });

afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});

function renderPair(sidoValue = "서울", sigunguValue = "강남구") {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const base = {
    boardId: `board-${boardSequence}`,
    itemId: "item-1",
    sidoKey: "sido",
    sigunguKey: "sigungu",
    sidoValue,
    sigunguValue,
    readOnly: false,
  };
  return { host, root, base };
}

function sidoInput(host: HTMLElement): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>('input[name="item-1-sido-region"]');
  if (!input) throw new Error("sido input missing");
  return input;
}

function sigunguInput(host: HTMLElement): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>('input[name="item-1-sigungu-region"]');
  if (!input) throw new Error("sigungu input missing");
  return input;
}

function typeInto(input: HTMLInputElement, next: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("value setter missing");
  setter.call(input, next);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function blurOut(input: HTMLInputElement): void {
  input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
}

describe("RegionPairCell 행단위 공유 pending", () => {
  it("한 셀 저장 중 다른 셀 쓰기를 잠그고 성공 시 동시에 갱신한다", async () => {
    let resolveSave: ((result: { ok: boolean; message: string; sido?: string; sigungu?: string }) => void) | null = null;
    boardActionMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    const { host, root, base } = renderPair();
    await act(async () => {
      root.render(
        <>
          <RegionCell {...base} kind="sido" />
          <RegionCell {...base} kind="sigungu" />
        </>,
      );
    });

    // 시도 변경(강남구는 경기에 딸리지 않아 시군구 초기화와 같은 요청으로 묶인다).
    await act(async () => {
      typeInto(sidoInput(host), "경기");
      blurOut(sidoInput(host));
    });
    expect(boardActionMock).toHaveBeenCalledTimes(1);
    expect(boardActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ boardId: "board-1", itemId: "item-1", sido: "경기", sigungu: "" }),
    );

    // 저장 중 — 시군구 셀은 잠긴다.
    expect(sigunguInput(host).disabled).toBe(true);

    // 잠긴 동안 시군구 저장을 시도해도 두 번째 요청이 나가지 않는다.
    await act(async () => {
      blurOut(sigunguInput(host));
    });
    expect(boardActionMock).toHaveBeenCalledTimes(1);

    // 성공 — 두 셀이 동시에 갱신된다.
    await act(async () => {
      resolveSave!({ ok: true, message: "✓ 자동 저장됨", sido: "경기", sigungu: "" });
    });
    expect(sidoInput(host).value).toBe("경기");
    expect(sigunguInput(host).value).toBe("");
    expect(sigunguInput(host).disabled).toBe(false);
    await act(async () => {
      root.unmount();
    });
  });

  it("실패하면 양쪽 입력을 보존하고 잠금을 푼다", async () => {
    boardActionMock.mockResolvedValueOnce({ ok: false, message: "저장을 못했어요. 입력은 유지됩니다." });
    const { host, root, base } = renderPair();
    await act(async () => {
      root.render(
        <>
          <RegionCell {...base} kind="sido" />
          <RegionCell {...base} kind="sigungu" />
        </>,
      );
    });

    await act(async () => {
      typeInto(sidoInput(host), "부산");
      blurOut(sidoInput(host));
    });
    expect(boardActionMock).toHaveBeenCalledTimes(1);

    await act(async () => {});
    // 실패 입력 보존 — 시도 입력이 유지되고 실패 문구가 보인다.
    expect(sidoInput(host).value).toBe("부산");
    expect(host.textContent).toContain("저장을 못했어요");
    // 잠금은 풀린다.
    expect(sigunguInput(host).disabled).toBe(false);
    await act(async () => {
      root.unmount();
    });
  });

  it("저장 중 remount에도 잠금을 이어받아 서버 쓰기를 직렬화한다", async () => {
    let resolveA: ((result: { ok: boolean; message: string; sido?: string; sigungu?: string }) => void) | null = null;
    let resolveB: ((result: { ok: boolean; message: string; sido?: string; sigungu?: string }) => void) | null = null;
    boardActionMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveA = resolve;
        }),
    );
    const first = renderPair();
    await act(async () => {
      first.root.render(
        <>
          <RegionCell {...first.base} kind="sido" />
          <RegionCell {...first.base} kind="sigungu" />
        </>,
      );
    });
    await act(async () => {
      typeInto(sidoInput(first.host), "경기");
      blurOut(sidoInput(first.host));
    });
    expect(boardActionMock).toHaveBeenCalledTimes(1);

    // A 진행 중 unmount — 요청의 공유 잠금은 유지된다.
    await act(async () => {
      first.root.unmount();
    });

    // 같은 행을 다시 마운트해도 A 완료 전 B를 시작할 수 없다.
    boardActionMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveB = resolve;
        }),
    );
    const second = renderPair();
    await act(async () => {
      second.root.render(
        <>
          <RegionCell {...second.base} kind="sido" />
          <RegionCell {...second.base} kind="sigungu" />
        </>,
      );
    });
    await act(async () => {
      typeInto(sidoInput(second.host), "부산");
      blurOut(sidoInput(second.host));
    });
    expect(boardActionMock).toHaveBeenCalledTimes(1);
    expect(sigunguInput(second.host).disabled).toBe(true);

    // A가 실제로 완료된 이후에만 B를 허용한다.
    await act(async () => {
      resolveA!({ ok: true, message: "✓ 자동 저장됨", sido: "경기", sigungu: "" });
    });
    await act(async () => {});
    expect(sigunguInput(second.host).disabled).toBe(false);
    expect(sidoInput(second.host).value).toBe("경기");
    await act(async () => {
      typeInto(sidoInput(second.host), "부산");
      blurOut(sidoInput(second.host));
    });
    expect(boardActionMock).toHaveBeenCalledTimes(2);

    // B 완료 — 그때야 부산으로 갱신되고 풀린다.
    await act(async () => {
      resolveB!({ ok: true, message: "✓ 자동 저장됨", sido: "부산", sigungu: "" });
    });
    expect(sidoInput(second.host).value).toBe("부산");
    expect(sigunguInput(second.host).value).toBe("");
    expect(sigunguInput(second.host).disabled).toBe(false);
    await act(async () => {
      second.root.unmount();
    });
  });

  it("transport 거부는 입력을 보존하고 양쪽 재저장을 새로고침까지 차단한다", async () => {
    boardActionMock.mockRejectedValueOnce(new Error("네트워크 끊김"));
    const { host, root, base } = renderPair();
    await act(async () => {
      root.render(
        <>
          <RegionCell {...base} kind="sido" />
          <RegionCell {...base} kind="sigungu" />
        </>,
      );
    });
    await act(async () => {
      typeInto(sidoInput(host), "부산");
      blurOut(sidoInput(host));
    });
    expect(boardActionMock).toHaveBeenCalledTimes(1);
    await act(async () => {});
    // 응답만 유실됐을 수 있으므로 저장 성공/실패를 단정하지 않는다.
    expect(sidoInput(host).value).toBe("부산");
    expect(sidoInput(host).disabled).toBe(true);
    expect(sigunguInput(host).disabled).toBe(true);
    expect(host.textContent).toContain("저장 결과를 다시 확인해야 합니다.");
    expect(host.textContent).toContain("새로고침하여 확인");
    expect(host.querySelector('[data-saved="true"]')).toBeNull();

    // 두 셀의 blur 모두 중복 요청을 만들지 않는다.
    await act(async () => {
      blurOut(sidoInput(host));
      blurOut(sigunguInput(host));
    });
    await act(async () => {});
    expect(boardActionMock).toHaveBeenCalledTimes(1);
    expect(sidoInput(host).value).toBe("부산");
    await act(async () => {
      root.unmount();
    });
  });

  it("옛 화면 요청의 늦은 transport 거부도 remount된 행 잠금을 풀지 않는다", async () => {
    let rejectA: ((error: Error) => void) | null = null;
    boardActionMock.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectA = reject; }));
    const first = renderPair();
    await act(async () => {
      first.root.render(
        <>
          <RegionCell {...first.base} kind="sido" />
          <RegionCell {...first.base} kind="sigungu" />
        </>,
      );
    });
    await act(async () => {
      typeInto(sidoInput(first.host), "경기");
      blurOut(sidoInput(first.host));
    });
    expect(boardActionMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      first.root.unmount();
    });

    const second = renderPair();
    await act(async () => {
      second.root.render(
        <>
          <RegionCell {...second.base} kind="sido" />
          <RegionCell {...second.base} kind="sigungu" />
        </>,
      );
    });
    await act(async () => {
      typeInto(sidoInput(second.host), "부산");
      blurOut(sidoInput(second.host));
    });
    expect(boardActionMock).toHaveBeenCalledTimes(1);
    await act(async () => {});
    // A가 진행 중이면 새 요청 B 자체가 허용되지 않는다.
    expect(sigunguInput(second.host).disabled).toBe(true);
    await act(async () => {
      rejectA!(new Error("A 응답 유실"));
    });
    expect(sidoInput(second.host).disabled).toBe(true);
    expect(sigunguInput(second.host).disabled).toBe(true);
    expect(second.host.textContent).toContain("새로고침하여 확인");
    await act(async () => { blurOut(sidoInput(second.host)); });
    expect(boardActionMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      second.root.unmount();
    });
    const third = renderPair();
    await act(async () => { third.root.render(<><RegionCell {...third.base} kind="sido" /><RegionCell {...third.base} kind="sigungu" /></>); });
    expect(sidoInput(third.host).disabled).toBe(true);
    expect(sigunguInput(third.host).disabled).toBe(true);
    await act(async () => { blurOut(sidoInput(third.host)); blurOut(sigunguInput(third.host)); });
    expect(boardActionMock).toHaveBeenCalledTimes(1);
    await act(async () => { third.root.unmount(); });
  });
  it("unknown blocks both fields and survives remount", async () => {
    boardActionMock.mockResolvedValueOnce({ ok: false, message: "확인 필요", requiresReload: true });
    const first = renderPair();
    await act(async () => { first.root.render(<><RegionCell {...first.base} kind="sido" /><RegionCell {...first.base} kind="sigungu" /></>); });
    await act(async () => { typeInto(sidoInput(first.host), "부산"); blurOut(sidoInput(first.host)); });
    expect(boardActionMock).toHaveBeenCalledTimes(1);
    expect(sidoInput(first.host).value).toBe("부산");
    expect(sidoInput(first.host).disabled).toBe(true);
    expect(sigunguInput(first.host).disabled).toBe(true);
    expect(first.host.querySelector('[data-saved="true"]')).toBeNull();
    expect(first.host.textContent).toContain("새로고침하여 확인");
    await act(async () => { blurOut(sidoInput(first.host)); first.root.unmount(); });
    const second = renderPair();
    await act(async () => { second.root.render(<><RegionCell {...second.base} kind="sido" /><RegionCell {...second.base} kind="sigungu" /></>); });
    expect(sidoInput(second.host).disabled).toBe(true);
    await act(async () => { blurOut(sidoInput(second.host)); });
    expect(boardActionMock).toHaveBeenCalledTimes(1);
    await act(async () => { second.root.unmount(); });
  });

});
