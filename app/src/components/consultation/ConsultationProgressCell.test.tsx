// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const consultationActions = vi.hoisted(() => ({
  readSnapshot: vi.fn(),
  readHandoff: vi.fn(),
}));

vi.mock("@/lib/consultation/actions", () => ({
  mutateConsultationChecklist: vi.fn(async () => ({ ok: false, message: "" })),
  mutateConsultationWorkflow: vi.fn(async () => ({ ok: false, message: "" })),
  mutateConsultationMode: vi.fn(async () => ({ ok: false, message: "" })),
  mutateConsultationHandoff: vi.fn(async () => ({ ok: false, message: "" })),
  readConsultationSnapshot: consultationActions.readSnapshot,
  readConsultationHandoff: consultationActions.readHandoff,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { boardEntryFromRow } from "@/lib/consultation/boardView";
import { ConsultationProgressCell } from "./ConsultationProgressCell";

function entryOf(confirmed: readonly boolean[], mode = "remote") {
  const keys = ["contract_sent", "signed_copy_sent", "counterparty_signature_confirmed", "deposit_confirmed"] as const;
  return boardEntryFromRow({
    item_id: "item-1",
    deal_id: "deal-1",
    company_id: null,
    mode,
    version: 2,
    meeting_at: null,
    checklist: Object.fromEntries(
      keys.map((key, index) => [
        key,
        confirmed[index]
          ? { confirmed: true, actor: "user-1", at: "2026-09-26T10:00:00+09:00" }
          : { confirmed: false, actor: null, at: null },
      ]),
    ),
    ready: false,
    missing: ["상대 서명 확인", "착수금 입금 확인"],
    seal_approved: false,
    seal_detail: "업무관리 이동을 먼저 선택해 주세요.",
    deal_stage_kind: "meeting",
  });
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.clearAllMocks();
  if (typeof HTMLDialogElement !== "undefined" && !HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  }
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  container = null;
  root = null;
  vi.unstubAllGlobals();
});

describe("ConsultationProgressCell", () => {
  it("표에서 진행 n/4 와 다음 단계를 읽는다", async () => {
    await act(async () => {
      root!.render(
        <ConsultationProgressCell itemId="item-1" title="테스트 건" entry={entryOf([true, true, false, false])} />,
      );
    });
    const html = container!.innerHTML;
    expect(html).toContain("계약 2/4");
    expect(html).toContain("다음: 상대 서명 확인");
    expect(html).toContain("확인 열기");
  });

  it("4완료면 완료로 읽힌다", async () => {
    await act(async () => {
      root!.render(
        <ConsultationProgressCell itemId="item-1" title="테스트 건" entry={entryOf([true, true, true, true])} />,
      );
    });
    expect(container!.innerHTML).toContain("4단계 완료");
  });

  it("확인 열기 팝오버에서 같은 패널이 뜬다 — 업무이동 메뉴 불필요", async () => {
    consultationActions.readSnapshot.mockResolvedValue({
      ok: true,
      message: "읽음",
      snapshot: {
        itemId: "item-1",
        dealId: "deal-1",
        companyId: null,
        boardSource: "core.default-tab/contact",
        stage: "remote",
        version: 2,
        meetingAt: null,
        checklist: {
          contract_sent: { confirmed: true, actorId: "u", at: "2026-09-26T10:00:00+09:00" },
          signed_copy_sent: { confirmed: true, actorId: "u", at: "2026-09-26T10:00:00+09:00" },
          counterparty_signature_confirmed: { confirmed: false, actorId: null, at: null },
          deposit_confirmed: { confirmed: false, actorId: null, at: null },
        },
        ready: false,
        missing: [],
        seal: { approved: false, detail: "" },
        dealStageKind: "meeting",
      },
    });
    consultationActions.readHandoff.mockResolvedValue({ ok: false, message: "남음", ready: false, missing: [] });
    await act(async () => {
      root!.render(
        <ConsultationProgressCell
          itemId="item-1"
          title="테스트 건"
          entry={entryOf([true, true, false, false])}
          members={[{ id: "user-1", label: "김담당" }]}
        />,
      );
    });
    const opener = container!.querySelector("button");
    await act(async () => {
      opener!.click();
    });
    await act(async () => {});
    const dialog = container!.querySelector("dialog");
    expect(dialog).not.toBeNull();
    expect(dialog!.innerHTML).toContain("계약서 송부");
    expect(dialog!.innerHTML).toContain("서명본 발송");
  });
  it("unstarted legacy row shows its actual phase, not contract zero of four", async () => {
    await act(async () => root!.render(<ConsultationProgressCell itemId="item-1" title="상담 건" entry={entryOf([false,false,false,false])} />));
    expect(container!.textContent).toContain("정보수집");
    expect(container!.textContent).not.toContain("계약 0/4");
  });

});
