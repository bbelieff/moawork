// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompanyDetail } from "./CompanyDetail";
import type { Company } from "@/lib/types";

/**
 * #6 — 회사 상세 「업무 시작」. 성공하면 페이지가 새 요청 열쇠로 다시 그려지므로,
 * 다음 클릭은 «같은 회사의 줄 하나 더» 다. 이미 살아 있는 업무 행이 있으면 한 번 묻고,
 * 제출 중에는 버튼을 막는다. 1:N 은 막지 않는다.
 */
let root: Root | null = null;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

const company: Company = {
  id: "company-1",
  org_id: "org-1",
  name: "모아상사",
  biz_type: null,
  region: null,
  owner_name: null,
  phone: null,
  email: null,
  revenue: null,
  founded_on: null,
  homepage: null,
  assigned_to: "user-1",
  created_at: "2026-01-01T00:00:00.000Z",
};

type RenderState = {
  liveWorkRowCount: number;
  requestId?: string;
  workStartStatus?: "ok" | "failed" | "invalid";
};

/**
 * 같은 root 에 다시 그리면 React 는 같은 자리의 상태를 이어 간다.
 * Next 가 «검색어만 바뀐» redirect(`?workStart=ok&dealId=…`) 뒤 페이지를 다시 그릴 때와 같은 조건이다.
 */
async function draw(action: (formData: FormData) => Promise<void>, state: RenderState) {
  await act(async () => {
    root!.render(
      <CompanyDetail
        company={company}
        deals={[]}
        stageNames={new Map()}
        workStartRequestId={state.requestId ?? "request-1"}
        workStartStatus={state.workStartStatus}
        startWorkAction={action}
        liveWorkRowCount={state.liveWorkRowCount}
      />,
    );
  });
}

async function render(liveWorkRowCount: number, action: (formData: FormData) => Promise<void>) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await draw(action, { liveWorkRowCount });
  return host;
}

const button = (host: HTMLElement, text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);

describe("회사 상세 — 업무 시작", () => {
  it("살아 있는 업무 행이 있으면 묻고, 「하나 더 시작」 을 눌러야 보낸다", async () => {
    const seen: [string, string][] = [];
    const action = vi.fn(async (formData: FormData) => {
      seen.push([String(formData.get("companyId")), String(formData.get("requestId"))]);
    });
    const host = await render(2, action);

    await act(async () => button(host, "업무 시작")?.click());
    expect(action).not.toHaveBeenCalled();
    expect(host.textContent).toContain("이 업체는 이미 진행 중인 업무가 2건 있어요 · 하나 더 시작할까요?");

    await act(async () => button(host, "취소")?.click());
    expect(host.textContent).not.toContain("하나 더 시작할까요?");

    await act(async () => button(host, "업무 시작")?.click());
    await act(async () => button(host, "업무 시작")?.click());
    expect(action).not.toHaveBeenCalled();
    await act(async () => button(host, "하나 더 시작")?.click());
    expect(seen).toEqual([["company-1", "request-1"]]);
  });

  it.each(["ok", "failed"] as const)(
    "서버가 새 요청 열쇠로 다시 그리면(%s) 지난 확인을 지운다 — 다음 시작은 다시 묻는다",
    async (workStartStatus) => {
      const seen: string[] = [];
      const action = vi.fn(async (formData: FormData) => {
        seen.push(String(formData.get("requestId")));
      });
      const host = await render(2, action);

      await act(async () => button(host, "업무 시작")?.click());
      await act(async () => button(host, "하나 더 시작")?.click());
      expect(seen).toEqual(["request-1"]);

      // 결과를 들고 같은 경로로 돌아온다 — 새 열쇠, 행은 하나 늘었다.
      await draw(action, { liveWorkRowCount: 3, requestId: "request-2", workStartStatus });
      expect(host.textContent).not.toContain("하나 더 시작할까요?");
      expect(button(host, "하나 더 시작")).toBeUndefined();

      await act(async () => button(host, "업무 시작")?.click());
      expect(seen).toEqual(["request-1"]);
      expect(host.textContent).toContain("이 업체는 이미 진행 중인 업무가 3건 있어요 · 하나 더 시작할까요?");

      await act(async () => button(host, "하나 더 시작")?.click());
      expect(seen).toEqual(["request-1", "request-2"]);
    },
  );

  it("같은 열쇠로 다시 그려지는 동안에는 열어 둔 확인을 유지한다", async () => {
    const action = vi.fn(async () => {});
    const host = await render(2, action);
    await act(async () => button(host, "업무 시작")?.click());
    await draw(action, { liveWorkRowCount: 2 });
    expect(host.textContent).toContain("하나 더 시작할까요?");
    expect(action).not.toHaveBeenCalled();
  });

  it("업무 행이 없으면 묻지 않고 바로 시작한다", async () => {
    const action = vi.fn(async () => {});
    const host = await render(0, action);
    await act(async () => button(host, "업무 시작")?.click());
    expect(action).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain("하나 더 시작할까요?");
  });

  it("제출 중에는 버튼을 막는다 — 서버 응답 전 연타가 두 번 나가지 않는다", async () => {
    let release!: () => void;
    const action = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const host = await render(0, action);

    await act(async () => button(host, "업무 시작")?.click());
    const pendingButton = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("시작하는 중"));
    expect(pendingButton?.disabled).toBe(true);
    await act(async () => pendingButton?.click());
    expect(action).toHaveBeenCalledTimes(1);

    await act(async () => release());
    expect(button(host, "업무 시작")?.disabled).toBe(false);
  });
});
