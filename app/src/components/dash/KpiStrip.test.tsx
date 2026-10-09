// @vitest-environment jsdom

import { act } from "react";
import { renderToString } from "react-dom/server";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CountUp, KpiStrip, type KpiStripItem } from "./KpiStrip";

// 이 파일이 빨개지는 조건:
//  · 서버 HTML 에 최종 숫자가 없어 스크립트 없이 읽을 수 없을 때
//  · 움직임 줄이기 설정인데 숫자가 움직일 때
//  · 조용한 새로고침(값만 바뀐 재렌더)에 숫자가 다시 0 부터 올라갈 때
//  · 휴대폰 점이 보이는 카드를 못 따라가거나, 점을 눌러도 그 카드로 안 갈 때

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let frames: FrameRequestCallback[] = [];
let root: Root | null = null;

/** 다음 프레임을 «now» 시각으로 돌린다. */
async function flushFrame(now: number) {
  const pending = frames;
  frames = [];
  await act(async () => {
    for (const callback of pending) callback(now);
  });
}

function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  mockReducedMotion(false);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function mount(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(node));
  return host;
}

const text = (host: HTMLElement) => host.querySelector("[data-count-up]")?.textContent;

describe("CountUp — 숫자 올라가기", () => {
  it("서버 HTML 에 최종 값이 그대로 있다(스크립트 없이 읽힌다)", () => {
    expect(renderToString(<CountUp value={8_000_000} unit="krw" />)).toContain("8,000,000원");
    expect(renderToString(<CountUp value={1234} unit="count" />)).toContain("1,234");
  });

  it("하이드레이션 직후에는 최종 값, 그 뒤 프레임에서 0 부터 올라가 최종 값으로 끝난다", async () => {
    const host = document.createElement("div");
    host.innerHTML = renderToString(<CountUp value={100} unit="count" />);
    document.body.append(host);
    await act(async () => {
      root = hydrateRoot(host, <CountUp value={100} unit="count" />);
    });
    expect(text(host)).toBe("100");

    await flushFrame(1000);
    expect(text(host)).toBe("0");
    await flushFrame(1450);
    const middle = Number(text(host));
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(100);
    await flushFrame(1900);
    expect(text(host)).toBe("100");
    expect(frames).toHaveLength(0);
  });

  it("움직임 줄이기면 프레임을 하나도 걸지 않고 최종 값만 보인다", async () => {
    mockReducedMotion(true);
    const host = await mount(<CountUp value={42} unit="count" />);
    expect(text(host)).toBe("42");
    expect(frames).toHaveLength(0);
  });

  it("값만 바뀐 재렌더(조용한 새로고침)에는 다시 올라가지 않는다", async () => {
    const host = await mount(<CountUp value={10} unit="count" />);
    await flushFrame(0);
    await flushFrame(1000);
    expect(text(host)).toBe("10");
    expect(frames).toHaveLength(0);

    await act(async () => root?.render(<CountUp value={25} unit="count" />));
    expect(text(host)).toBe("25");
    expect(frames).toHaveLength(0);
  });
});

const ITEMS: KpiStripItem[] = [
  { key: "a", label: "전화예정", value: 1, unit: "count" },
  { key: "b", label: "재통화 대기", value: 2, unit: "count" },
  { key: "c", label: "미팅예정", value: 3, unit: "count" },
];

describe("KpiStrip — 휴대폰 가로 넘김 점", () => {
  async function mountStrip() {
    mockReducedMotion(true); // 숫자 움직임은 이 묶음의 관심사가 아니다.
    const host = await mount(<KpiStrip items={ITEMS} />);
    const list = host.querySelector<HTMLUListElement>("[data-kpi-strip]")!;
    const cards = [...host.querySelectorAll<HTMLElement>("[data-kpi-card]")];
    // 카드 폭 280 + 간격 12, 왼쪽 여백 16 — jsdom 은 배치를 안 하므로 위치를 직접 준다.
    cards.forEach((card, index) => Object.defineProperty(card, "offsetLeft", { value: 16 + index * 292 }));
    const dots = [...host.querySelectorAll<HTMLButtonElement>("[data-kpi-dots] button")];
    return { host, list, dots };
  }

  it("카드마다 점 버튼이 하나씩, 처음엔 첫 점이 현재다", async () => {
    const { dots } = await mountStrip();
    expect(dots).toHaveLength(3);
    expect(dots[0].getAttribute("aria-current")).toBe("true");
    expect(dots[0].getAttribute("aria-label")).toBe("전화예정 보기");
  });

  it("넘기면 보이는 카드의 점이 현재가 된다", async () => {
    const { list, dots } = await mountStrip();
    list.scrollLeft = 584;
    await act(async () => list.dispatchEvent(new Event("scroll")));
    await flushFrame(0);
    expect(dots[2].getAttribute("aria-current")).toBe("true");
    expect(dots[0].getAttribute("aria-current")).toBeNull();
  });

  it("점을 누르면 그 카드로 넘어간다(왼쪽 여백만큼 덜)", async () => {
    const { list, dots } = await mountStrip();
    const scrollTo = vi.fn();
    list.scrollTo = scrollTo as unknown as typeof list.scrollTo;
    await act(async () => dots[1].click());
    expect(scrollTo).toHaveBeenCalledWith({ left: 292, behavior: "auto" });
    expect(dots[1].getAttribute("aria-current")).toBe("true");
  });

  it("움직임 줄이기가 아니면 부드럽게 넘어간다", async () => {
    const host = await mount(<KpiStrip items={ITEMS} />);
    const list = host.querySelector<HTMLUListElement>("[data-kpi-strip]")!;
    const scrollTo = vi.fn();
    list.scrollTo = scrollTo as unknown as typeof list.scrollTo;
    await act(async () => host.querySelectorAll<HTMLButtonElement>("[data-kpi-dots] button")[0].click());
    expect(scrollTo).toHaveBeenCalledWith({ left: 0, behavior: "smooth" });
  });
});
