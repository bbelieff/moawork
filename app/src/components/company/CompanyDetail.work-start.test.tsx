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

async function render(liveWorkRowCount: number, action: (formData: FormData) => Promise<void>) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <CompanyDetail
        company={company}
        deals={[]}
        stageNames={new Map()}
        workStartRequestId="request-1"
        startWorkAction={action}
        liveWorkRowCount={liveWorkRowCount}
      />,
    );
  });
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
