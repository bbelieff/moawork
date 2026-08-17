/**
 * BBE-183 — 회사 선택의 성공을 오류처럼 보이게 하던 회귀를 기계가 잡는다.
 *
 * 원인: `WorkspaceChooser` 가 성공/실패를 가르지 않고 모든 message 를 `styles.error` 로,
 *       그리고 실패까지 `role="status"` 로 렌더했다. 두 방향 모두 뜻이 뒤집혀 있었다.
 *   · 성공(`ok:true` · `selection_revalidation`) → 빨간 오류 배너로 보임
 *   · 실패(`ok:false` · `invalid`/`unavailable`) → alert 이 아니라 조용한 status 로 읽힘
 *
 * 서버 응답에는 이미 `ok` 라는 판정 근거가 있다(`app/src/app/api/workspace-requests/route.ts`).
 * 그래서 이 카드는 auth/session/DB/RPC 를 건드리지 않고 표현 계층만 고친다.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceRequestResult } from "@/lib/workspace-entry/contracts";
import { WorkspaceChooser, workspaceNoticeRole, workspaceSelectionNotice } from "./WorkspaceChooser";

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

describe("BBE-183 · 회사 선택 상태 표현", () => {
  it("성공 응답을 오류로 표시하지 않는다", () => {
    expect(workspaceSelectionNotice(SUCCESS)).toEqual({ tone: "success", text: SUCCESS.message });
  });

  it("실패 응답을 성공으로 표시하지 않는다", () => {
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

  it("최초 렌더에는 배너가 없고 선택 버튼이 열려 있다", () => {
    const html = renderToStaticMarkup(
      <WorkspaceChooser workspaces={[{ orgId: "org-1", slug: "seoul", name: "서울" } as never]} />,
    );

    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('data-tone=');
    expect(html).not.toContain("disabled");
  });
});
