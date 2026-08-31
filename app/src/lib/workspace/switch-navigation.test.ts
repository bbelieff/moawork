import { describe, expect, it } from "vitest";
import {
  NAVIGATION_STALL_MS,
  navigationKindFor,
} from "./switch-navigation";

/**
 * #671 — 「워크스페이스 드롭다운 눌러서 test로 이동하려고 하니 계속 멈추게됨」
 *
 * 여기서 막지 않으면 워크스페이스 전환이 «조용히» 아무 일도 안 하는 상태로 돌아간다.
 * 목적지가 쿠키를 심는 Route Handler 라 클라이언트 이동으로는 절대 완성되지 않는다.
 */

describe("#671 워크스페이스 주소는 «문서 요청» 이어야 한다", () => {
  it("/w/<slug> 는 문서 이동이다 — 서버가 org 쿠키를 심어야 전환이 끝난다", () => {
    expect(navigationKindFor("/w/test")).toBe("document");
    expect(navigationKindFor("/w/seoul-management")).toBe("document");
  });

  it("하위 경로와 질의가 붙어도 문서 이동이다", () => {
    expect(navigationKindFor("/w/test/dashboard")).toBe("document");
    expect(navigationKindFor("/w/test?from=switcher")).toBe("document");
    expect(navigationKindFor("/w/test#top")).toBe("document");
  });

  it("그 밖의 주소는 평소대로 클라이언트 이동이다 — 새 회사 만들기·합류하기", () => {
    expect(navigationKindFor("/workspaces/new")).toBe("client");
    expect(navigationKindFor("/workspace-entry")).toBe("client");
    expect(navigationKindFor("/platform/organizations")).toBe("client");
  });

  it("★ 「/w」 로 시작만 해서는 안 된다 — /workspaces 를 워크스페이스 전환으로 오인하지 않는다", () => {
    expect(navigationKindFor("/workspaces")).toBe("client");
    expect(navigationKindFor("/w")).toBe("client");
    expect(navigationKindFor("/w/")).toBe("client");
  });

  it("빈 주소는 클라이언트 쪽으로 둔다 — 호출부가 이미 빈 값을 막는다", () => {
    expect(navigationKindFor("")).toBe("client");
  });
});

describe("#671 멈춘 채로 두지 않는다", () => {
  it("시한이 있고, 사람이 기다릴 만한 길이다", () => {
    expect(NAVIGATION_STALL_MS).toBeGreaterThanOrEqual(2000);
    expect(NAVIGATION_STALL_MS).toBeLessThanOrEqual(10000);
  });
});
