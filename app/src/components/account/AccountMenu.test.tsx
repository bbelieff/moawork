import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccountMenu } from "./AccountMenu";

const props = { displayName: "가상 사용자", initial: "가", accountHref: "/account" };

describe("AccountMenu developer-mode entry", () => {
  it("does not expose an administrator entry without a server-confirmed capability", () => {
    expect(renderToStaticMarkup(<AccountMenu {...props} platformModeAction={{ mode: "platform", next: "/platform" }} />)).not.toContain("관리자 모드로");
  });

  it("renders the trusted user-mode entry only when capability and action agree", () => {
    const html = renderToStaticMarkup(<AccountMenu {...props} serverConfirmedCanAccessPlatform platformModeAction={{ mode: "platform", next: "/platform" }} />);
    expect(html).toContain("관리자 모드로");
    expect(html).toContain('action="/mode/preference"');
  });
});
