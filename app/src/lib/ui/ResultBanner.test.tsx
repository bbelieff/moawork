import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResultBanner } from "./ResultBanner";

// BBE-208 — «그려진 마크업» 에서 role 을 읽는다.
//
// ★ 왜 소스 단언으로 안 끝내는가: 오늘 「쓰여 있음 ≠ 그려짐」이 두 번 벌어졌다.
//   · BBE-199 이니셜 마크 — 소스엔 있었는데 흰 글자 + 투명 배경이라 안 보였다
//   · BBE-212 칸반 배너   — 소스엔 있었는데 뷰 분기 밖이라 안 그려졌다
//   이 카드의 주제가 「보조기술이 무엇을 인지하는가」라, 검사가 소스에서 멈추면 주제를 못 잰다.
//
// 이 배너를 쓰는 곳: ApprovalQueue(합류 승인·거절) · PlatformOrganizationsPanel(조직 처리).
// 둘 다 실패가 「처리됐다」로 «들리면» 결과가 무거운 자리다.

describe("ResultBanner — 그려진 결과에서 판정을 읽는다", () => {
  // 되돌리면 빨개진다: role 을 "status" 고정으로
  it("★ 실패는 alert 로 그려진다 — 「처리됐다」로 들리지 않는다", () => {
    const html = renderToStaticMarkup(
      <ResultBanner notice={{ ok: false, message: "처리하지 못했어요." }} okClassName="ok" errorClassName="bad" />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain('class="bad"');
    expect(html).not.toContain('role="status"');
    expect(html).toContain("처리하지 못했어요.");
  });

  // ★ 되돌리면 빨개진다: 성공까지 alert 로 (전부 빨갛게 칠해서 도망)
  it("★ 성공은 status 로 그려진다 — 전부 alert 로 칠하는 도망도 막는다", () => {
    const html = renderToStaticMarkup(
      <ResultBanner notice={{ ok: true, message: "처리했어요." }} okClassName="ok" errorClassName="bad" />,
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('class="ok"');
    expect(html).not.toContain('role="alert"');
  });

  // 되돌리면 빨개진다: 색을 판정과 무관하게 고정하기
  it("★ 색과 role 이 «같은» 판정에서 나온다 — 한 채널만 갈리면 안 된다", () => {
    const fail = renderToStaticMarkup(
      <ResultBanner notice={{ ok: false, message: "x" }} okClassName="ok" errorClassName="bad" />,
    );
    const pass = renderToStaticMarkup(
      <ResultBanner notice={{ ok: true, message: "x" }} okClassName="ok" errorClassName="bad" />,
    );

    // 실패: alert + 오류색 / 성공: status + 성공색. 엇갈리면 두 사용자가 다른 사실을 본다.
    expect(fail.includes('role="alert"') && fail.includes('class="bad"')).toBe(true);
    expect(pass.includes('role="status"') && pass.includes('class="ok"')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ★ 이 PR 이 «고친 두 자리» 를 못으로 박는다 (DC-18 지적)
//
//   사각을 정직하게 적은 것과, 그 사각에 «방금 고친 것» 이 들어 있는 것은 다른 문제다.
//   두 수정 모두 전수 검사기가 «원리적으로 못 보는» 범위(prop 판정 부품 · 빈 문자열 관용구)에
//   있어서, 되돌려도 스위트 전체가 초록이었다 — 실측 2404 passed · 실패 0.
//   검사기가 못 보는 자리는 «그려진 마크업» 을 직접 단언하는 것만이 답이다.
// ─────────────────────────────────────────────────────────────────────────────

import { DashboardUnavailable } from "@/components/dash/DashboardSourceSummary";

describe("고친 자리 ① DashboardUnavailable — 실패 부품이므로 alert 고정", () => {
  // 되돌리면 빨개진다: role 을 "status" 로 되돌리기
  it("★ 조회 실패를 alert 로 그린다 — status 로 두면 보조기술이 놓친다", () => {
    const html = renderToStaticMarkup(<DashboardUnavailable label="보드" />);

    expect(html).toContain('role="alert"');
    expect(html).not.toContain('role="status"');
    expect(html).toContain("불러오지 못함");
  });
});
