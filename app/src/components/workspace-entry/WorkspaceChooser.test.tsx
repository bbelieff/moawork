/**
 * BBE-183 — 회사 선택의 성공을 오류처럼 보이게 하던 회귀를 기계가 잡는다.
 *
 * 원인: `WorkspaceChooser` 가 성공/실패를 가르지 않고 모든 message 를 `styles.error` 로,
 *       그리고 실패까지 `role="status"` 로 렌더했다. 두 방향 모두 뜻이 뒤집혀 있었다.
 *   · 성공(`ok:true` · `selection_revalidation`) → 빨간 오류 배너로 보임
 *   · 실패(`ok:false` · `invalid`/`unavailable`) → alert 이 아니라 조용한 status 로 읽힘
 *
 * 서버 응답에는 이미 `ok` 라는 판정 근거가 있다(`app/src/app/api/workspace-requests/route.ts:35,41,43`).
 * 그래서 이 카드는 auth/session/DB/RPC 를 건드리지 않고 표현 계층만 고친다.
 *
 * 검사를 네 갈래로 나눈 이유 — 앞선 두 판이 각각 한 갈래씩 빠뜨렸고 그 구멍으로 회귀가 지나갔다:
 *   ① 판정   : 응답 → tone
 *   ② 배너   : tone → class·role·aria-live      (①만 있으면 «고른 tone 을 실제로 어떻게 그리는가» 가 빔)
 *   ③ 화면   : 화면이 그 배너를 실제로 붙이는가 · 잠금이 버튼에 닿는가
 *   ④ 흐름   : 클릭 → 응답 → 이동. 이동은 성공에 1회, 실패에 0회. 연타해도 요청 1회
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceEntryOption } from "@/lib/auth/workspace-entry-server";
import type { WorkspaceRequestResult } from "@/lib/workspace-entry/contracts";
import {
  WORKSPACE_CHOOSER_IDLE,
  WORKSPACE_REDIRECT_FAILED,
  WORKSPACE_REQUEST_FAILED,
  WorkspaceChooserView,
  WorkspaceSelectionNotice,
  runWorkspaceSelection,
  workspaceNoticeRole,
  workspaceSelectionNotice,
  type WorkspaceChooserView as View,
} from "./WorkspaceChooser";
import styles from "./workspace-entry.module.css";

vi.mock("@/lib/analytics/useTrack", () => ({ useTrack: () => () => {} }));

/** 운영에서 실제로 돌아오는 성공 응답 (route.ts select_workspace 분기). */
const SUCCESS: WorkspaceRequestResult = {
  ok: true,
  state: "selection_revalidation",
  message: "회사 접근을 다시 확인했어요. 안전하게 이동할게요.",
  redirectTo: "/w/seoul",
};

/** 운영에서 실제로 돌아오는 실패 응답 (membership 이 1건이 아닐 때). */
const FAILURE: WorkspaceRequestResult = {
  ok: false,
  state: "unavailable",
  message: "회사 접근을 확인할 수 없어요. 목록을 새로 확인해 주세요.",
};

const WORKSPACES = [{ orgId: "org-1", slug: "seoul", name: "서울" } as WorkspaceEntryOption];

const renderNotice = (result: WorkspaceRequestResult) =>
  renderToStaticMarkup(<WorkspaceSelectionNotice notice={workspaceSelectionNotice(result)} />);

const renderView = (view: View) =>
  renderToStaticMarkup(
    <WorkspaceChooserView workspaces={WORKSPACES} view={view} onSelect={() => {}} />,
  );

/** 컴포넌트가 하는 배선을 그대로 흉내내는 가짜 런타임. view 를 실제로 들고 있어야 연타 차단을 잰다. */
function harness(submit: (workspaceId: string) => Promise<WorkspaceRequestResult>) {
  const assigned: string[] = [];
  const submitted: string[] = [];
  let view: View = WORKSPACE_CHOOSER_IDLE;
  let assignThrows = false;

  return {
    get view() {
      return view;
    },
    assigned,
    submitted,
    failRedirect() {
      assignThrows = true;
    },
    fx: {
      getView: () => view,
      setView: (next: View) => {
        view = next;
      },
      submit: (workspaceId: string) => {
        submitted.push(workspaceId);
        return submit(workspaceId);
      },
      assign: (url: string) => {
        if (assignThrows) throw new Error("navigation blocked");
        assigned.push(url);
      },
    },
  };
}

describe("BBE-183 ① 판정 — 응답을 tone 으로", () => {
  it("성공 응답을 오류로 판정하지 않는다", () => {
    expect(workspaceSelectionNotice(SUCCESS)).toEqual({ tone: "success", text: SUCCESS.message });
  });

  it("실패 응답을 성공으로 판정하지 않는다", () => {
    expect(workspaceSelectionNotice(FAILURE)).toEqual({ tone: "error", text: FAILURE.message });
  });

  it("문구가 아니라 ok 로 판정한다 — 성공 문구에 «확인할 수 없어요» 가 들어가도 성공이다", () => {
    const oddSuccess: WorkspaceRequestResult = { ...SUCCESS, message: "접근을 확인할 수 없어요" };
    expect(workspaceSelectionNotice(oddSuccess).tone).toBe("success");
  });

  it("성공은 status(polite), 실패는 alert(assertive) 로 읽힌다", () => {
    expect(workspaceNoticeRole("success")).toBe("status");
    expect(workspaceNoticeRole("error")).toBe("alert");
  });

  it("state 가 늘어나도 ok:true 는 전부 성공으로 수렴한다", () => {
    const states: WorkspaceRequestResult["state"][] = [
      "pending",
      "expired",
      "cancelled",
      "approved",
      "rejected",
      "selection_revalidation",
    ];
    for (const state of states) {
      expect(workspaceSelectionNotice({ ok: true, state, message: "m" } as WorkspaceRequestResult).tone).toBe("success");
    }
    for (const state of ["invalid", "unavailable"] as const) {
      expect(workspaceSelectionNotice({ ok: false, state, message: "m" }).tone).toBe("error");
    }
  });
});

describe("BBE-183 ② 배너 — tone 을 실제로 그린 결과", () => {
  it("성공 배너에 오류 스타일이 붙지 않는다", () => {
    const html = renderNotice(SUCCESS);

    expect(html).toContain(styles.status);
    expect(html).not.toContain(styles.error);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain('role="alert"');
    expect(html).toContain(SUCCESS.message);
  });

  it("실패 배너는 오류 스타일과 alert 을 함께 쓴다", () => {
    const html = renderNotice(FAILURE);

    expect(html).toContain(styles.error);
    expect(html).not.toContain(styles.status);
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).not.toContain('role="status"');
    expect(html).toContain(FAILURE.message);
  });

  it("결과가 없으면 아무것도 그리지 않는다", () => {
    expect(renderToStaticMarkup(<WorkspaceSelectionNotice notice={null} />)).toBe("");
  });
});

describe("BBE-183 ③ 화면 — 배너를 실제로 붙이는가, 잠금이 버튼에 닿는가", () => {
  // 배너 컴포넌트가 아무리 옳아도 화면이 안 붙이면 사용자는 아무 피드백을 못 받는다.
  it("성공 상태의 화면에 성공 배너가 실제로 붙는다", () => {
    const html = renderView({ notice: { tone: "success", text: SUCCESS.message }, locked: true });

    expect(html).toContain('data-tone="success"');
    expect(html).toContain(styles.status);
    expect(html).toContain('role="status"');
    expect(html).toContain(SUCCESS.message);
  });

  it("실패 상태의 화면에 실패 배너가 실제로 붙는다", () => {
    const html = renderView({ notice: { tone: "error", text: FAILURE.message }, locked: false });

    expect(html).toContain('data-tone="error"');
    expect(html).toContain(styles.error);
    expect(html).toContain('role="alert"');
    expect(html).toContain(FAILURE.message);
  });

  it("잠긴 동안 회사 버튼이 눌리지 않는다", () => {
    expect(renderView({ notice: null, locked: true })).toContain("disabled");
  });

  it("잠기지 않았으면 버튼이 열려 있다 — 실패 뒤에는 다시 시도할 수 있어야 한다", () => {
    expect(renderView({ notice: { tone: "error", text: FAILURE.message }, locked: false })).not.toContain("disabled");
  });

  it("최초 화면에는 배너가 없고 버튼이 열려 있다", () => {
    const html = renderView(WORKSPACE_CHOOSER_IDLE);

    expect(html).not.toContain("data-tone=");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("disabled");
  });
});

describe("BBE-183 ④ 흐름 — 이동 횟수와 연타", () => {
  it("성공하면 이동을 정확히 1회 한다", async () => {
    const h = harness(async () => SUCCESS);

    await runWorkspaceSelection("org-1", h.fx);

    expect(h.assigned).toEqual(["/w/seoul"]);
    expect(h.view.notice).toEqual({ tone: "success", text: SUCCESS.message });
    // 이동이 시작됐으면 화면이 바뀔 때까지 잠긴 채로 둔다.
    expect(h.view.locked).toBe(true);
  });

  it("실패하면 이동하지 않고, 다시 시도할 수 있게 잠금을 푼다", async () => {
    const h = harness(async () => FAILURE);

    await runWorkspaceSelection("org-1", h.fx);

    expect(h.assigned).toEqual([]);
    expect(h.view.notice).toEqual({ tone: "error", text: FAILURE.message });
    expect(h.view.locked).toBe(false);
  });

  it("이동이 시작된 뒤 다시 눌러도 요청도 이동도 늘지 않는다", async () => {
    const h = harness(async () => SUCCESS);

    await runWorkspaceSelection("org-1", h.fx);
    await runWorkspaceSelection("org-1", h.fx);
    await runWorkspaceSelection("org-1", h.fx);

    expect(h.submitted).toEqual(["org-1"]);
    expect(h.assigned).toEqual(["/w/seoul"]);
  });

  it("요청이 끝나기 전에 연타해도 요청은 1회다", async () => {
    let release: (r: WorkspaceRequestResult) => void = () => {};
    const pending = new Promise<WorkspaceRequestResult>((resolve) => {
      release = resolve;
    });
    const h = harness(() => pending);

    const first = runWorkspaceSelection("org-1", h.fx);
    const second = runWorkspaceSelection("org-1", h.fx);
    release(SUCCESS);
    await Promise.all([first, second]);

    expect(h.submitted).toEqual(["org-1"]);
    expect(h.assigned).toEqual(["/w/seoul"]);
  });

  it("요청 자체가 던지면 오류 배너를 띄우고 이동하지 않는다", async () => {
    const h = harness(async () => {
      throw new Error("network down");
    });

    await runWorkspaceSelection("org-1", h.fx);

    expect(h.assigned).toEqual([]);
    expect(h.view.notice).toEqual({ tone: "error", text: WORKSPACE_REQUEST_FAILED });
    expect(h.view.locked).toBe(false);
  });

  // 이동 호출이 던지는데 잠금을 안 풀면 «성공 배너 + 아무것도 못 함» 이라는 막다른 길이 된다.
  it("이동 호출이 실패하면 잠금을 풀고 이동 실패를 따로 알린다", async () => {
    const h = harness(async () => SUCCESS);
    h.failRedirect();

    await runWorkspaceSelection("org-1", h.fx);

    expect(h.view.notice).toEqual({ tone: "error", text: WORKSPACE_REDIRECT_FAILED });
    expect(h.view.locked).toBe(false);
    // 요청 실패와 이동 실패는 사용자가 할 일이 달라서 문구가 같으면 안 된다.
    expect(WORKSPACE_REDIRECT_FAILED).not.toBe(WORKSPACE_REQUEST_FAILED);
  });
});
