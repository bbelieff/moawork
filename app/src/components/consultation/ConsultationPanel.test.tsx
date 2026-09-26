// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const consultationActions = vi.hoisted(() => ({
  readSnapshot: vi.fn(),
  readHandoff: vi.fn(),
  mutateChecklist: vi.fn(),
  mutateMode: vi.fn(),
  mutateHandoff: vi.fn(),
  mutateWorkflow: vi.fn(),
}));

vi.mock("@/lib/consultation/actions", () => ({
  mutateConsultationChecklist: consultationActions.mutateChecklist,
  mutateConsultationMode: consultationActions.mutateMode,
  mutateConsultationWorkflow: consultationActions.mutateWorkflow,
  mutateConsultationHandoff: consultationActions.mutateHandoff,
  readConsultationSnapshot: consultationActions.readSnapshot,
  readConsultationHandoff: consultationActions.readHandoff,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ConsultationPanel } from "./ConsultationPanel";

function checklist(confirmed: readonly boolean[]) {
  const keys = ["contract_sent", "signed_copy_sent", "counterparty_signature_confirmed", "deposit_confirmed"] as const;
  return Object.fromEntries(
    keys.map((key, index) => [
      key,
      confirmed[index]
        ? { confirmed: true, actorId: "user-1", at: "2026-09-26T10:00:00.000+09:00" }
        : { confirmed: false, actorId: null, at: null },
    ]),
  );
}

function snapshotOf(stage: string, confirmed: readonly boolean[], version = 2) {
  return {
    ok: true,
    message: "상담 기록을 읽었습니다.",
    version,
    ready: false,
    missing: [],
    mode: stage,
    meetingAt: "2026-10-01T10:00:00.000+09:00",
    dealId: "deal-1",
    companyId: null,
    snapshot: {
      itemId: "item-1",
      dealId: "deal-1",
      companyId: null,
      boardSource: "core.default-tab/contact",
      stage,
      version,
      meetingAt: "2026-10-01T10:00:00.000+09:00",
      checklist: checklist(confirmed),
      ready: false,
      missing: [],
      seal: { approved: true, detail: "" },
      dealStageKind: "meeting",
    },
  };
}

function handoffOf(ready: boolean) {
  return ready
    ? { ok: true, message: "인계 조건을 모두 채웠습니다.", version: 4, ready: true, missing: [], nextAction: { kind: "contact_to_work", dealId: "deal-1", sourceItemId: "item-1" } }
    : { ok: false, message: "남은 조건 있음", version: 2, ready: false, missing: ["서명본 발송", "상대 서명 확인", "착수금 입금 확인"], nextAction: null };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.clearAllMocks();
  consultationActions.mutateChecklist.mockResolvedValue({ ok: false, message: "" });
  consultationActions.mutateWorkflow.mockResolvedValue({ ok: false, message: "" });
  consultationActions.mutateMode.mockResolvedValue({ ok: false, message: "" });
  consultationActions.mutateHandoff.mockResolvedValue({ ok: false, message: "" });
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

async function renderPanel(props?: { stage?: string; confirmed?: readonly boolean[]; handoffReady?: boolean; version?: number }) {
  const stage = props?.stage ?? "remote";
  const confirmed = props?.confirmed ?? [true, false, false, false];
  const version = props?.version ?? 2;
  consultationActions.readSnapshot.mockResolvedValue(snapshotOf(stage, confirmed, version));
  consultationActions.readHandoff.mockResolvedValue(handoffOf(props?.handoffReady ?? false));
  await act(async () => {
    root!.render(
      <ConsultationPanel
        itemId="item-1"
        title="테스트 건"
        initialMeetingAt="2026-10-01T10:00:00.000+09:00"
        currentAssigneeId="user-1"
        members={[{ id: "user-1", label: "김담당" }]}
        initialCompanyName="테스트 건"
      />,
    );
  });
  await act(async () => {});
  return container!.innerHTML;
}

function boxes(): HTMLInputElement[] {
  return [...container!.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
}

function expectedVersionOf(callIndex: number): string {
  const form = consultationActions.mutateChecklist.mock.calls[callIndex][1] as FormData;
  return String(form.get("expectedVersion"));
}

describe("ConsultationPanel", () => {
  it("renders the stored instant as browser-local time without shifting it", async () => {
    await renderPanel();
    const local = container!.querySelector<HTMLInputElement>('input[name="meetingAt"]')!.value;
    // Independent of the runner's zone: KST 10:00 and UTC 01:00 denote this instant.
    expect(new Date(local).toISOString()).toBe("2026-10-01T01:00:00.000Z");
  });

  it("4단계를 순서대로 보여주고 앞 단계 미완이면 뒤 확인을 막는다", async () => {
    const html = await renderPanel({ confirmed: [true, false, false, false] });
    expect(html).toContain("계약서 송부");
    expect(html).toContain("서명본 발송");
    expect(html).toContain("상대 서명 확인");
    expect(html).toContain("착수금 입금 확인");
    expect(html).toContain("워크스페이스 회사 → 고객사");
    const list = boxes();
    expect(list).toHaveLength(4);
    expect(list[0].checked).toBe(true);
    expect(list[1].disabled).toBe(false);
    expect(list[2].disabled).toBe(true);
  });

  it("예약 일시·담당자·보기 전이를 같은 패널에서 입력한다", async () => {
    await renderPanel();
    const meeting = container!.querySelector('input[name="meetingAt"]');
    const assignee = container!.querySelector('select[name="assigneeId"]');
    expect(meeting).not.toBeNull();
    expect(assignee).not.toBeNull();
    expect(assignee!.innerHTML).toContain("김담당");
    expect(container!.innerHTML).toContain("대면 예약으로 이동");
  });

  it("미완이면 인계를 막고 사유를 보여준다", async () => {
    const html = await renderPanel({ handoffReady: false });
    const handoff = [...container!.querySelectorAll("button")].find((b) => b.textContent?.includes("실무로 인계"));
    expect(handoff).toBeDefined();
    expect((handoff as HTMLButtonElement).disabled).toBe(true);
    expect(html).toContain("서명본 발송");
  });

  it("완료되면 인계 버튼이 열린다", async () => {
    await renderPanel({ confirmed: [true, true, true, true], handoffReady: true });
    const handoff = [...container!.querySelectorAll("button")].find((b) => b.textContent?.includes("실무로 인계"));
    expect(handoff).toBeDefined();
    expect((handoff as HTMLButtonElement).disabled).toBe(false);
  });

  it("신규리드 행에서는 정식 이전 안내만 보여준다", async () => {
    const html = await renderPanel({ stage: "new_lead", confirmed: [false, false, false, false] });
    expect(html).toContain("lead_to_contact");
    expect(container!.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it("저장 성공 뒤 추가 버튼 없이 바로 갱신된다", async () => {
    await renderPanel({ confirmed: [true, false, false, false], version: 2 });
    consultationActions.mutateChecklist.mockResolvedValueOnce({
      ok: true,
      message: "확인했습니다.",
      version: 3,
    });
    consultationActions.readSnapshot.mockResolvedValueOnce(snapshotOf("remote", [true, true, false, false], 3));
    consultationActions.readHandoff.mockResolvedValueOnce(handoffOf(false));
    await act(async () => {
      boxes()[1].click();
    });
    await act(async () => {});
    // 다시 읽기 버튼이 없다 — 저장 뒤 자동 갱신이다.
    expect(container!.innerHTML).not.toContain("최신 상태 다시 읽기");
    const list = boxes();
    expect(list[0].checked).toBe(true);
    expect(list[1].checked).toBe(true);
    // 앞 2단계가 찼으므로 3단계가 이어서 열려 있다 — 연속 확인.
    expect(list[2].disabled).toBe(false);
    expect(list[3].disabled).toBe(true);
    expect(container!.innerHTML).toContain("확인했습니다.");
    expect(consultationActions.readSnapshot).toHaveBeenCalledTimes(2);
  });

  it("연속 확인은 새 기준으로 추가 버튼 없이 이어진다", async () => {
    await renderPanel({ confirmed: [true, false, false, false], version: 2 });
    consultationActions.mutateChecklist.mockResolvedValueOnce({ ok: true, message: "확인했습니다.", version: 3 });
    consultationActions.readSnapshot.mockResolvedValueOnce(snapshotOf("remote", [true, true, false, false], 3));
    consultationActions.readHandoff.mockResolvedValueOnce(handoffOf(false));
    await act(async () => {
      boxes()[1].click();
    });
    await act(async () => {});
    consultationActions.mutateChecklist.mockResolvedValueOnce({ ok: true, message: "확인했습니다.", version: 4 });
    consultationActions.readSnapshot.mockResolvedValueOnce(
      snapshotOf("remote", [true, true, true, false], 4),
    );
    consultationActions.readHandoff.mockResolvedValueOnce(handoffOf(false));
    await act(async () => {
      boxes()[2].click();
    });
    await act(async () => {});
    // 첫 저장은 v2 기준, 다음 저장은 새 기준 v3 으로 나간다.
    expect(expectedVersionOf(0)).toBe("2");
    expect(expectedVersionOf(1)).toBe("3");
    expect(boxes().filter((box) => box.checked)).toHaveLength(3);
    expect(container!.innerHTML).not.toContain("최신 상태 다시 읽기");
  });

  it("CAS 실패는 오류 + 새 기준으로 돌려주고 초안은 보존한다", async () => {
    await renderPanel({ confirmed: [true, false, false, false], version: 2 });
    const meetingBeforeFailure = container!.querySelector<HTMLInputElement>('input[name="meetingAt"]')!.value;
    consultationActions.mutateChecklist.mockResolvedValueOnce({
      ok: false,
      message: "다른 담당자가 먼저 변경했습니다. 새로고침 후 다시 시도해 주세요.",
    });
    consultationActions.readSnapshot.mockResolvedValueOnce(snapshotOf("remote", [true, false, false, false], 5));
    consultationActions.readHandoff.mockResolvedValueOnce(handoffOf(false));
    await act(async () => {
      boxes()[1].click();
    });
    await act(async () => {});
    expect(container!.innerHTML).toContain("다른 담당자가 먼저 변경했습니다");
    expect(container!.querySelector('[role="alert"]')?.getAttribute("aria-live")).toBe("assertive");
    expect(container!.querySelector('[role="alert"]')?.className).toContain("text-mw-error");
    // 예약 일시·담당자 초안은 그대로다.
    const meeting = container!.querySelector('input[name="meetingAt"]') as HTMLInputElement;
    const assignee = container!.querySelector('select[name="assigneeId"]') as HTMLSelectElement;
    expect(meeting.value).toBe(meetingBeforeFailure);
    expect(assignee.value).toBe("user-1");
    await act(async () => { boxes()[1].click(); });
    expect(expectedVersionOf(1)).toBe("5");
  });

  it("예약(보기 전환) 성공 뒤에도 추가 버튼 없이 갱신된다", async () => {
    await renderPanel({ confirmed: [true, false, false, false], version: 2 });
    consultationActions.mutateWorkflow.mockResolvedValue({ ok: false, message: "" });
  consultationActions.mutateMode.mockResolvedValueOnce({
      ok: true,
      message: "상담 보기를 옮겼습니다.",
      version: 3,
      mode: "inperson",
    });
    consultationActions.readSnapshot.mockResolvedValueOnce(
      snapshotOf("inperson", [true, false, false, false], 3),
    );
    consultationActions.readHandoff.mockResolvedValueOnce(handoffOf(false));
    const mover = [...container!.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("대면 예약으로 이동"),
    )!;
    await act(async () => {
      mover.click();
    });
    await act(async () => {});
    const sent = consultationActions.mutateMode.mock.calls[0][1] as FormData;
    expect(String(sent.get("to"))).toBe("inperson");
    expect(String(sent.get("meetingAt"))).toBe("2026-10-01T01:00:00.000Z");
    expect(String(sent.get("assigneeId"))).toBe("user-1");
    expect(String(sent.get("expectedVersion"))).toBe("2");
    expect(container!.innerHTML).toContain("상담 보기를 옮겼습니다.");
    expect(container!.querySelector('[role="status"]')?.getAttribute("aria-live")).toBe("polite");
    expect(container!.querySelector('[role="status"]')?.className).toContain("text-mw-success");
    expect(container!.innerHTML).toContain("대면 상담");
    expect(container!.innerHTML).not.toContain("최신 상태 다시 읽기");
  });

  it("인계 성공을 그 자리에서 알린다", async () => {
    await renderPanel({ confirmed: [true, true, true, true], handoffReady: true, version: 4 });
    consultationActions.mutateHandoff.mockResolvedValueOnce({
      ok: true,
      message: "업무관리로 인계했습니다.",
      version: 4,
    });
    consultationActions.readSnapshot.mockResolvedValueOnce(
      snapshotOf("remote", [true, true, true, true], 4),
    );
    consultationActions.readHandoff.mockResolvedValueOnce(handoffOf(true));
    const handoff = [...container!.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("실무로 인계"),
    )!;
    await act(async () => {
      handoff.click();
    });
    await act(async () => {});
    expect(consultationActions.mutateHandoff).toHaveBeenCalledTimes(1);
    expect(container!.innerHTML).toContain("업무관리로 인계했습니다.");
  });

  it("새 제출에 요청 ID를 부여한다", async () => {
    await renderPanel({ confirmed: [true, false, false, false], version: 2 });
    consultationActions.mutateChecklist.mockResolvedValueOnce({ ok: true, message: "확인했습니다.", version: 3 });
    consultationActions.readSnapshot.mockResolvedValueOnce(snapshotOf("remote", [true, true, false, false], 3));
    consultationActions.readHandoff.mockResolvedValueOnce(handoffOf(false));
    await act(async () => {
      boxes()[1].click();
    });
    await act(async () => {});
    const first = String(
      (consultationActions.mutateChecklist.mock.calls[0][1] as FormData).get("requestId"),
    );
    expect(first.length).toBeGreaterThan(7);
  });

  it("최초 조회 예외는 한국어로 안내하고 다시 읽기로 복구한다", async () => {
    consultationActions.readSnapshot.mockRejectedValueOnce(new Error("An error occurred in the Server Components render"));
    await renderPanel();
    expect(container!.textContent).toContain("잠시 후 다시 읽어 주세요");
    expect(container!.textContent).not.toContain("Server Components");
    const retry = [...container!.querySelectorAll("button")].find((b) => b.textContent === "다시 읽기")!;
    await act(async () => { retry.click(); });
    expect(boxes()).toHaveLength(4);
    expect(consultationActions.mutateChecklist).not.toHaveBeenCalled();
  });

  it.each(["check", "mode", "handoff"] as const)("%s 응답 유실 시 입력을 잠그고 동일 요청 전체로만 다시 확인한다", async (kind) => {
    await renderPanel({ confirmed: [true, true, true, true], handoffReady: true, version: 4 });
    const mutation = kind === "check" ? consultationActions.mutateChecklist
      : kind === "mode" ? consultationActions.mutateMode : consultationActions.mutateHandoff;
    mutation.mockRejectedValueOnce(new Error("fetch failed: response lost after commit"));
    const meeting = container!.querySelector<HTMLInputElement>('input[name="meetingAt"]')!;
    const assignee = container!.querySelector<HTMLSelectElement>('select[name="assigneeId"]')!;
    const draft = { meeting: meeting.value, assignee: assignee.value };
    await act(async () => {
      if (kind === "check") boxes()[0].click();
      else if (kind === "mode") container!.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      else [...container!.querySelectorAll("button")].find((b) => b.textContent?.includes("실무로 인계"))!.click();
    });
    expect(container!.textContent).toContain("저장 여부를 확인할 수 없습니다");
    expect(container!.textContent).not.toContain("fetch failed");
    expect(container!.querySelector('[role="status"]')).toBeNull();
    expect(meeting.value).toBe(draft.meeting);
    expect(assignee.value).toBe(draft.assignee);
    expect(meeting.disabled).toBe(true);
    expect(assignee.disabled).toBe(true);
    expect(boxes().every((box) => box.disabled)).toBe(true);
    const first = Object.fromEntries((mutation.mock.calls[0][1] as FormData).entries());
    // Even a programmatic submit cannot replace an unresolved original payload.
    await act(async () => {
      container!.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(consultationActions.mutateMode).toHaveBeenCalledTimes(kind === "mode" ? 1 : 0);
    mutation.mockResolvedValueOnce({ ok: true, message: "확인했습니다.", replayed: true });
    await act(async () => {
      [...container!.querySelectorAll("button")].find((b) => b.textContent === "같은 요청 다시 확인")!.click();
    });
    const replay = Object.fromEntries((mutation.mock.calls[1][1] as FormData).entries());
    expect(replay).toEqual(first);
    expect(replay.expectedVersion).toBe("4");
    expect(replay.requestId).toBeTruthy();
    expect(container!.textContent).not.toContain("저장 여부를 확인할 수 없습니다");
    expect(meeting.disabled).toBe(false);
  });

  it("동일 렌더 안의 연속 제출도 동기 ref로 한 번만 보낸다", async () => {
    await renderPanel();
    let finish!: (value: { ok: boolean; message: string }) => void;
    consultationActions.mutateMode.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await act(async () => {
      const form = container!.querySelector("form")!;
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(consultationActions.mutateMode).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ ok: false, message: "일정을 다시 확인해 주세요." }); });
    expect(container!.textContent).toContain("일정을 다시 확인해 주세요");
    expect(container!.querySelector<HTMLInputElement>('input[name="meetingAt"]')!.disabled).toBe(false);
  });

  it("유실 재확인에서 명시적 거부를 받으면 초안을 유지하며 새 기준으로 수정할 수 있다", async () => {
    await renderPanel({ version: 2 });
    const meetingBeforeFailure = container!.querySelector<HTMLInputElement>('input[name="meetingAt"]')!.value;
    consultationActions.mutateMode.mockRejectedValueOnce(new Error("transport"));
    await act(async () => { container!.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    consultationActions.mutateWorkflow.mockResolvedValue({ ok: false, message: "" });
  consultationActions.mutateMode.mockResolvedValueOnce({ ok: false, message: "다른 담당자가 먼저 변경했습니다." });
    consultationActions.readSnapshot.mockResolvedValueOnce(snapshotOf("remote", [true, false, false, false], 7));
    await act(async () => { [...container!.querySelectorAll("button")].find((b) => b.textContent === "같은 요청 다시 확인")!.click(); });
    expect(container!.textContent).toContain("다른 담당자가 먼저 변경했습니다");
    expect(container!.querySelector<HTMLInputElement>('input[name="meetingAt"]')!.value).toBe(meetingBeforeFailure);
    await act(async () => { container!.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    const forms = consultationActions.mutateMode.mock.calls.map((call) => call[1] as FormData);
    expect(forms[1].get("requestId")).toBe(forms[0].get("requestId"));
    expect(forms[2].get("requestId")).not.toBe(forms[0].get("requestId"));
    expect(forms[2].get("expectedVersion")).toBe("7");
  });

  it("저장 후 기준 조회 예외도 한국어로 표시하고 초안을 보존한다", async () => {
    await renderPanel();
    const meetingBeforeFailure = container!.querySelector<HTMLInputElement>('input[name="meetingAt"]')!.value;
    consultationActions.mutateWorkflow.mockResolvedValue({ ok: false, message: "" });
  consultationActions.mutateMode.mockResolvedValueOnce({ ok: false, message: "다른 담당자가 먼저 변경했습니다." });
    consultationActions.readSnapshot.mockRejectedValueOnce(new Error("Server Components render failure"));
    await act(async () => { container!.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(container!.textContent).toContain("잠시 후 다시 읽어 주세요");
    expect(container!.textContent).not.toContain("Server Components");
    await act(async () => { [...container!.querySelectorAll("button")].find((b) => b.textContent === "다시 읽기")!.click(); });
    expect(container!.querySelector<HTMLInputElement>('input[name="meetingAt"]')!.value).toBe(meetingBeforeFailure);
  });
  it("same-mode schedule update and cancel use workflow CAS instead of mode switching", async () => {
    await renderPanel({ stage: "remote", version: 8 });
    const button = (label: string) => [...container!.querySelectorAll("button")].find((b) => b.textContent === label)!;
    await act(async () => button("예약 변경").click());
    const first = consultationActions.mutateWorkflow.mock.calls[0][1] as FormData;
    expect(first.get("mode")).toBe("remote"); expect(first.get("phase")).toBe("scheduled");
    expect(first.get("meetingAt")).toBe("2026-10-01T01:00:00.000Z");
    expect(first.get("expectedVersion")).toBe("8"); expect(first.get("assigneeId")).toBe("user-1");
    // Cancelling an existing reservation must ignore incomplete replacement drafts.
    await act(async () => {
      const meeting = container!.querySelector<HTMLInputElement>('input[name="meetingAt"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(meeting, "");
      meeting.dispatchEvent(new Event("input", { bubbles: true }));
      const assignee = container!.querySelector<HTMLSelectElement>('select[name="assigneeId"]')!;
      assignee.value = "";
      assignee.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => button("예약 취소").click());
    expect(consultationActions.mutateWorkflow).toHaveBeenCalledTimes(2);
    const second = consultationActions.mutateWorkflow.mock.calls[1][1] as FormData;
    expect(second.get("phase")).toBe("on_hold"); expect(second.get("cancel")).toBe("true");
    expect(second.get("meetingAt")).toBe(""); expect(consultationActions.mutateMode).not.toHaveBeenCalled();
  });

  it("workflow unknown result locks new intents and retries the identical request and version", async () => {
    await renderPanel({ stage: "inperson", version: 8 });
    consultationActions.mutateWorkflow.mockResolvedValueOnce({ ok: false, field: "unknown_result", message: "unknown" });
    const button = (label: string) => [...container!.querySelectorAll("button")].find((b) => b.textContent === label)!;
    await act(async () => button("예약 취소").click());
    const first = consultationActions.mutateWorkflow.mock.calls[0][1] as FormData;
    expect(first.get("phase")).toBe("cancelled");
    expect(button("예약 변경").disabled).toBe(true);
    expect((container!.querySelector('[aria-label="상담 단계"]') as HTMLSelectElement).disabled).toBe(true);
    await act(async () => button("같은 요청 다시 확인").click());
    const replay = consultationActions.mutateWorkflow.mock.calls[1][1] as FormData;
    expect([...replay]).toEqual([...first]);
  });

  it("remote phase choice includes the in-person appointment transition", async () => {
    await renderPanel({ stage: "remote", version: 3 });
    const select = container!.querySelector('[aria-label="상담 단계"]') as HTMLSelectElement;
    expect([...select.options].map((option) => option.text)).toEqual(["정보수집","상담예정","상담중","보류","거절","재상담","계약 진행","대면상담예약"]);
    await act(async () => { select.value = "meeting_scheduled"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => [...container!.querySelectorAll("button")].find((b) => b.textContent === "단계 저장")!.click());
    const form = consultationActions.mutateWorkflow.mock.calls[0][1] as FormData;
    expect(form.get("mode")).toBe("inperson"); expect(form.get("phase")).toBe("meeting_scheduled");
    expect(form.get("meetingAt")).toBeTruthy(); expect(form.get("assigneeId")).toBe("user-1");
  });

});
