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
 * 검사 방향이 두 갈래인 이유: tone 을 고르는 순수 함수만 검사하면 «고른 tone 을 실제로
 * 어떤 색·role 로 그리는가» 가 빈다. 실제로 그 구멍으로 이 버그가 지나갔다. 그래서 배너를
 * 직접 렌더해 class·role·aria-live 를 함께 확인한다.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceRequestResult } from "@/lib/workspace-entry/contracts";
import {
  WorkspaceChooser,
  WorkspaceSelectionNotice,
  workspaceNoticeRole,
  workspaceSelectionNotice,
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

const renderNotice = (result: WorkspaceRequestResult) =>
  renderToStaticMarkup(<WorkspaceSelectionNotice notice={workspaceSelectionNotice(result)} />);

describe("BBE-183 · 회사 선택 상태 판정", () => {
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

describe("BBE-183 · 배너를 실제로 그린 결과", () => {
  // 이 두 개가 카드의 수용기준 1·2 를 직접 지킨다. 매핑이 되돌아가면 여기서 깨진다.
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

  it("성공과 실패는 서로 다른 tone 으로 구분된다", () => {
    expect(renderNotice(SUCCESS)).toContain('data-tone="success"');
    expect(renderNotice(FAILURE)).toContain('data-tone="error"');
  });

  it("결과가 없으면 아무것도 그리지 않는다", () => {
    expect(renderToStaticMarkup(<WorkspaceSelectionNotice notice={null} />)).toBe("");
  });
});

describe("BBE-183 · 선택 화면 최초 렌더", () => {
  it("배너가 없고 선택 버튼이 열려 있다", () => {
    const html = renderToStaticMarkup(
      <WorkspaceChooser workspaces={[{ orgId: "org-1", slug: "seoul", name: "서울" } as never]} />,
    );

    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("data-tone=");
    expect(html).not.toContain("disabled");
  });
});
