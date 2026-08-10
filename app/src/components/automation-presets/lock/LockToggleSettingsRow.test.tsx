import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LockToggleSettingsRow } from "./LockToggleSettingsRow";

describe("LockToggleSettingsRow", () => {
  it("켜짐 상태와 왜 있는지 한 줄 설명을 함께 보여준다(D66 ①)", () => {
    const html = renderToStaticMarkup(
      <LockToggleSettingsRow enabled={true} onSubmit={vi.fn()} />,
    );
    expect(html).toContain("이중 잠금");
    expect(html).toContain("켜짐");
    expect(html).toContain("안전장치");
    expect(html).toContain('aria-pressed="true"');
  });

  it("끔 상태를 보여준다", () => {
    const html = renderToStaticMarkup(
      <LockToggleSettingsRow enabled={false} onSubmit={vi.fn()} />,
    );
    expect(html).toContain("꺼짐");
    expect(html).toContain('aria-pressed="false"');
  });

  it("최근 변경 기록이 있으면 누가·언제·왜 껐는지 보여준다", () => {
    const html = renderToStaticMarkup(
      <LockToggleSettingsRow
        enabled={false}
        lastAudit={{ actor: "이대표", enabled: false, reason: "담당자 요청", at: "2026-08-10T00:00:00.000Z" }}
        onSubmit={vi.fn()}
      />,
    );
    expect(html).toContain("이대표");
    expect(html).toContain("담당자 요청");
    expect(html).toContain("끔");
  });

  it("기록이 없으면 이력 문구를 그리지 않는다", () => {
    const html = renderToStaticMarkup(
      <LockToggleSettingsRow enabled={true} onSubmit={vi.fn()} />,
    );
    expect(html).not.toContain("마지막 변경");
  });

  it("거부 사유(error)가 있으면 사유 입력 폼과 함께 보여준다", () => {
    const html = renderToStaticMarkup(
      <LockToggleSettingsRow enabled={true} onSubmit={vi.fn()} error="이유를 입력해야 합니다" />,
    );
    // error 는 사유 폼이 열려 있을 때만 뜨는 문맥이라, 최소한 폼 없이는 안 보여야 한다
    // (아직 «끄기»를 누르지 않은 초기 렌더에서는 textarea 자체가 없다).
    expect(html).not.toContain("<textarea");
  });
});
