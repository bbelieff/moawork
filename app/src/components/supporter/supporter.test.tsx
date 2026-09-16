import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SupporterDock, SupporterOpenButton, SUPPORTER_HELP_LINKS } from "./SupporterDock";
import {
  applyNotConfiguredSubmit,
  canSubmitSupporterInput,
  isStaleSupporterReply,
  supporterThreadKey,
  SupporterProvider,
  SUPPORTER_INPUT_MAX_LENGTH,
  type ThreadState,
} from "./SupporterProvider";

function closedUserSurface(): string {
  return renderToStaticMarkup(
    <SupporterProvider contextKey="org-1" allowOperations={false}>
      <SupporterOpenButton />
      <SupporterDock />
    </SupporterProvider>,
  );
}

function openSurface(allowOperations: boolean): string {
  return renderToStaticMarkup(
    <SupporterProvider contextKey="org-1" allowOperations={allowOperations} initialOpen>
      <SupporterOpenButton />
      <SupporterDock />
    </SupporterProvider>,
  );
}

describe("SupporterDock markup", () => {
  it("stays closed by default: only the opener button, no panel", () => {
    const html = closedUserSurface();
    expect(html).toContain("모아서포터");
    expect(html).not.toContain("<aside");
    expect(html).not.toContain("운영서포터");
    expect(html).not.toContain("서포터 입력");
  });

  it("opens the user panel without an operations toggle", () => {
    const html = openSurface(false);
    expect(html).toContain("<aside");
    expect(html).toContain('aria-label="모아서포터"');
    expect(html).toContain("AI 연결 준비 중");
    expect(html).toContain("서포터 입력");
    expect(html).toContain("보내기");
    expect(html).not.toContain("운영서포터 전환");
    expect(html).not.toContain("현재 세션 불러오기");
  });

  it("shows an explicit input counter against the 2000 cap", () => {
    expect(SUPPORTER_INPUT_MAX_LENGTH).toBe(2000);
    const html = openSurface(false);
    expect(html).toContain('aria-label="입력 글자 수"');
    expect(html).toContain(`0 / ${SUPPORTER_INPUT_MAX_LENGTH}`);
    expect(html.toLowerCase()).toContain(`maxlength="${SUPPORTER_INPUT_MAX_LENGTH}"`);
  });

  it("hides the operations toggle until the server verifies the context", () => {
    // allowOperations 는 표면 조건일 뿐이다. 서버 판정 전에는 토글이 없다.
    const html = openSurface(true);
    expect(html).toContain('aria-label="모아서포터"');
    expect(html).not.toContain("운영서포터 전환");
    expect(html).not.toContain("현재 세션 불러오기");
  });

  it("links only verified in-app routes, never guessed URLs", () => {
    for (const link of SUPPORTER_HELP_LINKS) {
      expect(link.href.startsWith("/")).toBe(true);
      expect(link.href).not.toContain("http");
    }
    const hrefs = SUPPORTER_HELP_LINKS.map((link) => link.href);
    expect(hrefs).toContain("/settings/automations");
    expect(hrefs).toContain("/settings/members");
  });
});

describe("supporter thread guards", () => {
  const base: ThreadState = { messages: [], draft: "", pending: false, error: null };

  it("keys records by context and mode separately", () => {
    expect(supporterThreadKey("org-1", "user")).not.toBe(
      supporterThreadKey("org-2", "user"),
    );
    expect(supporterThreadKey("org-1", "user")).not.toBe(
      supporterThreadKey("org-1", "operations"),
    );
    expect(supporterThreadKey("platform", "operations")).not.toBe(
      supporterThreadKey("org-1", "operations"),
    );
  });

  it("blocks duplicate submits while a request is in flight", () => {
    expect(canSubmitSupporterInput({ pending: false, text: " 도와줘 " })).toBe(true);
    expect(canSubmitSupporterInput({ pending: true, text: "도와줘" })).toBe(false);
    expect(canSubmitSupporterInput({ pending: false, text: "   " })).toBe(false);
    expect(canSubmitSupporterInput({ pending: false, text: "" })).toBe(false);
  });

  it("drops late in-flight replies from an older epoch", () => {
    expect(isStaleSupporterReply(3, 4)).toBe(true);
    expect(isStaleSupporterReply(4, 4)).toBe(false);
  });

  it("keeps the draft on not-configured submit without impersonating the provider", () => {
    const next = applyNotConfiguredSubmit(base, "영업 관리판 만들어줘");
    expect(next.draft).toBe("영업 관리판 만들어줘");
    // 사용자 말풍선 하나 + 명시적 error 상태. 가짜 서포터 답변은 없다.
    expect(next.messages).toHaveLength(1);
    expect(next.messages[0]).toMatchObject({ from: "me", text: "영업 관리판 만들어줘" });
    expect(next.error).toContain("AI 연결 준비 중");
    expect(next.error).toContain("실행되지 않았어요");
    expect(next.error).not.toContain("완료");
  });

  it("does not duplicate the guidance on repeated submits", () => {
    const once = applyNotConfiguredSubmit(base, "도와줘");
    const twice = applyNotConfiguredSubmit(once, "다시 도와줘");
    expect(twice.messages).toHaveLength(2);
    expect(twice.messages.every((message) => message.from === "me")).toBe(true);
    expect(twice.error).toBe(once.error);
    expect(twice.draft).toBe("다시 도와줘");
  });

  it("caps long work requests at 2000 with the draft preserved", () => {
    const long = "가".repeat(2500);
    const next = applyNotConfiguredSubmit(base, long);
    expect(next.draft).toHaveLength(2000);
    expect(next.messages[0].text).toHaveLength(2000);
  });

  it("does not change the thread on duplicate or empty submits", () => {
    const busy: ThreadState = { ...base, pending: true };
    expect(applyNotConfiguredSubmit(busy, "x")).toBe(busy);
    expect(applyNotConfiguredSubmit(base, "   ")).toBe(base);
  });
});
