// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/w/sample-lab/boards/b-1" }));

import { ContractWorkIntakeForm } from "./ContractWorkIntakeForm";
import type { CompanyPickerRow } from "@/lib/companies/search";
import type { CompanyIntakeActionState } from "@/app/(app)/boards/[id]/company-intake-actions";

/**
 * 목록이 잘렸을 때 «뭐라고 말하는가» 를 잰다 (#588 ②).
 *
 * ★ 이 화면에서 제일 위험한 문장은 「찾는 업체가 없다면 … 먼저 등록해 주세요」다.
 *   목록이 잘렸는데 그 문장이 그대로 나오면, 이미 있는 회사를 «없다» 고 읽고
 *   새로 만든다 — 이 화면이 막으려던 중복을 이 화면이 만든다.
 *   그래서 «등록을 권하는가 / 찾아보라고 하는가» 를 판정한다.
 */
let root: Root | null = null;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

const ROWS: CompanyPickerRow[] = [
  { company: { id: "c-1", org_id: "org-1", name: "가나상사" } as unknown as CompanyPickerRow["company"], dealCount: 0 },
];

const action = vi.fn(async () => ({ ok: true, message: "" }) as CompanyIntakeActionState);

async function render(props: { truncated?: boolean }) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <ContractWorkIntakeForm
        rows={ROWS}
        boardId="b-1"
        groupId="g-1"
        startWorkAction={action}
        truncated={props.truncated}
      />,
    );
  });
  const trigger = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("업체 추가"));
  await act(async () => trigger?.click());
  return host;
}

describe("업체 추가 — 목록이 잘렸을 때 (#588)", () => {
  it("안 잘렸으면 종전대로 «먼저 등록해 주세요» 로 안내한다", async () => {
    const host = await render({});
    expect(host.textContent).toContain("먼저 등록해 주세요");
    expect(host.textContent).not.toContain("일부만");
  });

  it("★ 잘렸으면 등록을 권하지 않고 «먼저 찾아보라» 고 말한다", async () => {
    const host = await render({ truncated: true });
    expect(host.textContent).toContain("먼저 찾아 주세요");
    expect(host.textContent).not.toContain("먼저 등록해 주세요");
    // 몇 곳까지 담겼는지 숫자로 밝힌다 — 「많아서 일부」 는 사람이 판단할 근거가 못 된다.
    expect(host.textContent).toContain(`${ROWS.length}곳까지만`);
  });

  it("★ 잘린 채 «못 찾았다» 를 말할 때는 없다고 단정하지 않는다", async () => {
    const host = await render({ truncated: true });
    const search = host.querySelector("input[type='search'], input:not([type])") as HTMLInputElement | null;
    expect(search).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      setter?.call(search, "없는회사");
      search!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.textContent).toContain("찾은 업체가 없습니다");
    expect(host.textContent).toContain("없다고 단정하지 마세요");
  });
});
