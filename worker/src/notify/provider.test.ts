import { describe, it, expect } from "vitest";
import { resolveProvider } from "./provider.js";
import { StubProvider, defaultProviders } from "./providers/stub.js";
import { isSchemaChannel } from "./types.js";

describe("resolveProvider", () => {
  it("채널을 지원하는 첫 프로바이더를 고른다", () => {
    const sms = new StubProvider(["sms"]);
    const email = new StubProvider(["email"]);
    expect(resolveProvider([sms, email], "email")).toBe(email);
  });

  it("지원 프로바이더가 없으면 undefined", () => {
    expect(resolveProvider([new StubProvider(["sms"])], "alimtalk")).toBeUndefined();
  });
});

describe("StubProvider", () => {
  it("기본 구성은 email/sms/alimtalk 을 모두 받는다", () => {
    const [p] = defaultProviders();
    expect(p?.supports("email")).toBe(true);
    expect(p?.supports("sms")).toBe(true);
    expect(p?.supports("alimtalk")).toBe(true);
  });

  it("발송 시 성공 결과와 추적 가능한 id 를 돌려준다", async () => {
    const logs: string[] = [];
    const p = new StubProvider(["sms"], (m) => logs.push(m));
    const r = await p.send({ id: "m1", channel: "sms", to: "01000000000", body: "본문" });

    expect(r).toEqual({ ok: true, providerMessageId: "stub-m1" });
    // 개인정보(수신처·본문)는 로그에 남기지 않는다.
    expect(logs.join()).not.toContain("01000000000");
    expect(logs.join()).not.toContain("본문");
  });
});

describe("isSchemaChannel", () => {
  it("정본 스키마(message_channel)는 alimtalk/sms 만 수용한다", () => {
    expect(isSchemaChannel("alimtalk")).toBe(true);
    expect(isSchemaChannel("sms")).toBe(true);
    // email 은 스키마 enum 에 없는 확장 채널 — 도입 시 마이그레이션 선행 필요.
    expect(isSchemaChannel("email")).toBe(false);
  });
});
