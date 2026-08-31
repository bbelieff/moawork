// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/w/sample-lab/boards/b-1" }));

import { ContractWorkIntakeForm } from "./ContractWorkIntakeForm";
import type { CompanyPickerRow } from "@/lib/companies/search";
import type { CompanyIntakeActionState } from "@/app/(app)/boards/[id]/company-intake-actions";

/**
 * 「＋ 업체 추가」의 멱등 열쇠 — «실제로 제출되는 값» 을 본다.
 *
 * ★ 이 파일이 원본 문자열이 아니라 «동작» 을 재는 이유.
 *   처음 판은 컴포넌트 소스를 readFileSync 해서 정규식으로 검사했다. 그러면
 *   React 의 제출 순서가 반대여서 기능이 100% 깨져도 네 건 다 초록이다.
 *   서식만 바뀌어도(Prettier 재정렬·defaultValue={""}) 빨개진다 —
 *   즉 «틀린 것은 못 잡고 안 틀린 것은 잡는» 테스트였다.
 *   여기서는 액션이 실제로 받은 FormData 를 기록해서 판정한다.
 */
let root: Root | null = null;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

function row(id: string, name: string): CompanyPickerRow {
  return {
    company: { id, org_id: "org-1", name } as unknown as CompanyPickerRow["company"],
    dealCount: 0,
  };
}

const ROWS = [row("c-1", "가나상사"), row("c-2", "다라물산")];

/** 액션이 «실제로 받은» companyId·requestId 를 순서대로 모은다. */
function mount(respond?: (form: FormData) => Promise<CompanyIntakeActionState>) {
  const seen: { companyId: string; requestId: string; groupId: string | null }[] = [];
  const action = vi.fn(async (_prev: CompanyIntakeActionState, form: FormData) => {
    const group = form.get("groupId");
    seen.push({
      companyId: String(form.get("companyId") ?? ""),
      requestId: String(form.get("requestId") ?? ""),
      groupId: typeof group === "string" ? group : null,
    });
    return respond ? await respond(form) : { ok: true, message: "" } as CompanyIntakeActionState;
  });

  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  return { seen, action, host };
}

async function open(host: HTMLElement) {
  const trigger = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("업체 추가"));
  await act(async () => trigger?.click());
}

function submitFor(host: HTMLElement, companyId: string) {
  const field = host.querySelector(`input[name="companyId"][value="${companyId}"]`);
  return field?.closest("form") as HTMLFormElement | undefined;
}

describe("업체 추가 — 멱등 열쇠", () => {
  it("회사A 다음에 회사B 를 골라도 «서로 다른» 열쇠로 나간다 — 이게 이 PR 의 본론이다", async () => {
    const { seen, action, host } = mount();
    await act(async () => {
      root!.render(<ContractWorkIntakeForm rows={ROWS} boardId="b-1" groupId="g-2" startWorkAction={action} truncated={false} />);
    });
    await open(host);

    await act(async () => submitFor(host, "c-1")?.requestSubmit());
    await act(async () => submitFor(host, "c-2")?.requestSubmit());

    expect(seen.map((s) => s.companyId)).toEqual(["c-1", "c-2"]);
    // 비어 있으면 서버가 「업체를 선택한 뒤 다시 시도해 주세요」로 거절한다.
    expect(seen[0].requestId).not.toBe("");
    expect(seen[1].requestId).not.toBe("");
    // 같으면 RPC 가 22023 으로 두 번째를 거절한다(117 마이그레이션 :92).
    expect(seen[0].requestId).not.toBe(seen[1].requestId);
  });

  it("같은 회사를 한 틱에 두 번 눌러도 열쇠는 «하나» 다 — 자금 건이 둘 생기면 안 된다", async () => {
    const { seen, action, host } = mount();
    await act(async () => {
      root!.render(<ContractWorkIntakeForm rows={ROWS} boardId="b-1" groupId="g-2" startWorkAction={action} truncated={false} />);
    });
    await open(host);

    // 렌더가 끼어들 틈 없이 연달아 — disabled={pending} 이 아직 안 걸린 창이다.
    await act(async () => {
      const form = submitFor(host, "c-1");
      form?.requestSubmit();
      form?.requestSubmit();
    });

    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(new Set(seen.map((s) => s.requestId)).size).toBe(1);
  });

  it("열쇠가 uuid 꼴이다 — RPC 인자가 uuid 타입이다", async () => {
    const { seen, action, host } = mount();
    await act(async () => {
      root!.render(<ContractWorkIntakeForm rows={ROWS} boardId="b-1" groupId="g-2" startWorkAction={action} truncated={false} />);
    });
    await open(host);
    await act(async () => submitFor(host, "c-1")?.requestSubmit());

    expect(seen[0].requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("★ 누른 그룹이 그대로 실려 간다 — 이게 없으면 서버가 «맨 위» 그룹에 넣는다 (#588)", async () => {
    const { seen, action, host } = mount();
    await act(async () => {
      root!.render(<ContractWorkIntakeForm rows={ROWS} boardId="b-1" groupId="g-2" startWorkAction={action} truncated={false} />);
    });
    await open(host);
    await act(async () => submitFor(host, "c-1")?.requestSubmit());

    expect(seen[0].groupId).toBe("g-2");
  });

  it("「그룹 없음」 블록에서는 그룹을 안 보낸다 — 서버가 첫 그룹을 고른다", async () => {
    const { seen, action, host } = mount();
    await act(async () => {
      root!.render(<ContractWorkIntakeForm rows={ROWS} boardId="b-1" groupId={null} startWorkAction={action} truncated={false} />);
    });
    await open(host);
    await act(async () => submitFor(host, "c-1")?.requestSubmit());

    // 빈 문자열을 보내면 서버가 «그룹을 지정했는데 못 찾았다» 로 거절한다. 아예 안 보내야 한다.
    expect(seen[0].groupId).toBeNull();
  });

  it("randomUUID 가 없는 곳(보안 컨텍스트 아님)에서도 열쇠가 나간다", async () => {
    const original = globalThis.crypto.randomUUID;
    // http://192.168.x.x 로 여는 375px 확인에서 실제로 undefined 다.
    Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      const { seen, action, host } = mount();
      await act(async () => {
        root!.render(<ContractWorkIntakeForm rows={ROWS} boardId="b-1" groupId="g-2" startWorkAction={action} truncated={false} />);
      });
      await open(host);
      await act(async () => submitFor(host, "c-1")?.requestSubmit());

      expect(seen[0]?.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    } finally {
      Object.defineProperty(globalThis.crypto, "randomUUID", { value: original, configurable: true });
    }
  });

  it("unknown outcome 재시도는 같은 열쇠를 쓰고 terminal success 뒤 새 intent는 회전한다", async () => {
    let attempt = 0;
    const { seen, action, host } = mount(async (form) => {
      attempt += 1;
      const requestId = String(form.get("requestId"));
      return attempt === 1
        ? { ok: false, message: "retry", retry: { companyId: "c-1", groupId: "g-2", requestId } }
        : { ok: true, message: "done" };
    });
    await act(async () => {
      root!.render(<ContractWorkIntakeForm rows={ROWS} boardId="b-1" groupId="g-2" startWorkAction={action} truncated={false} />);
    });
    await open(host);
    await act(async () => submitFor(host, "c-1")?.requestSubmit());
    await act(async () => submitFor(host, "c-1")?.requestSubmit());
    await act(async () => submitFor(host, "c-1")?.requestSubmit());

    expect(seen[1].requestId).toBe(seen[0].requestId);
    expect(seen[2].requestId).not.toBe(seen[1].requestId);
  });

  it("terminal conflict 뒤에는 이전 열쇠를 버리고 새 intent를 발급한다", async () => {
    let attempt = 0;
    const { seen, action, host } = mount(async () => {
      attempt += 1;
      return attempt === 1 ? { ok: false, message: "conflict" } : { ok: true, message: "done" };
    });
    await act(async () => {
      root!.render(<ContractWorkIntakeForm rows={ROWS} boardId="b-1" groupId="g-2" startWorkAction={action} truncated={false} />);
    });
    await open(host);
    await act(async () => submitFor(host, "c-1")?.requestSubmit());
    await act(async () => submitFor(host, "c-1")?.requestSubmit());
    expect(seen[1].requestId).not.toBe(seen[0].requestId);
  });
});
