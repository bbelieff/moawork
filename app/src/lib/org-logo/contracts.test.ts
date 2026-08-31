import { describe, expect, it } from "vitest";
import {
  ORG_LOGO_ALLOWED_MIME,
  ORG_LOGO_MAX_BYTES,
  orgLogoFailureMessage,
  orgLogoObjectPath,
  orgLogoReasonFromRpcError,
  validateOrgLogoUpload,
  validateOrgLogoContent,
} from "./contracts";

const ORG = "11111111-1111-4111-8111-111111111111";

describe("validateOrgLogoUpload", () => {
  it("허용 형식 3종을 통과시킨다", () => {
    for (const mime of ORG_LOGO_ALLOWED_MIME) {
      expect(validateOrgLogoUpload({ mime, bytes: 1000 })).toEqual({ ok: true, mime });
    }
  });

  it("사유를 뭉개지 않는다 — 빈파일·형식·용량이 각각 다르다", () => {
    expect(validateOrgLogoUpload({ mime: "image/png", bytes: 0 })).toEqual({ ok: false, reason: "empty" });
    expect(validateOrgLogoUpload({ mime: "image/gif", bytes: 10 })).toEqual({ ok: false, reason: "bad_format" });
    expect(validateOrgLogoUpload({ mime: "image/png", bytes: ORG_LOGO_MAX_BYTES + 1 })).toEqual({ ok: false, reason: "too_large" });
  });

  it("상한 경계를 정확히 잡는다", () => {
    expect(validateOrgLogoUpload({ mime: "image/png", bytes: ORG_LOGO_MAX_BYTES }).ok).toBe(true);
    expect(validateOrgLogoUpload({ mime: "image/png", bytes: ORG_LOGO_MAX_BYTES + 1 }).ok).toBe(false);
    /*
     * #652 — 1 MiB 였던 것을 4 MiB 로 넓혔다.
     *
     * ★ 옛 값이 하필 Next 서버 액션 본문 상한(1 MB)과 «같아서», 조금이라도 큰 파일은
     *   우리 코드가 실행되기 전에 잘렸다 — 「너무 커요」라는 안내조차 못 떴다.
     *   그래서 둘을 떼어 놓는다. next.config.ts 의 bodySizeLimit 이 이보다 커야 한다.
     */
    expect(ORG_LOGO_MAX_BYTES).toBe(4 * 1024 * 1024);
  });
});

describe("validateOrgLogoContent", () => {
  it("accepts real PNG/JPEG signatures and rejects spoofed declarations", () => {
    expect(validateOrgLogoContent("image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toEqual({ ok: true });
    expect(validateOrgLogoContent("image/jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toEqual({ ok: true });
    expect(validateOrgLogoContent("image/png", new TextEncoder().encode("<html>not an image</html>")))
      .toEqual({ ok: false, reason: "bad_content" });
  });

  /*
   * #652 — 「이미지를 올려도 로고적용이 안되는게 문제임」.
   *
   * 전 판정기는 **실제 도구가 내보내는 파일을 거의 전부 거부했다.** 아래가 그 목록이고,
   * 지금은 전부 통과해야 한다. 하나라도 다시 막히면 로고는 또 «한 번도 안 올라가는» 기능이 된다.
   */
  it("★ 실제 도구가 내보낸 파일을 받는다", () => {
    const enc = (value: string) => new TextEncoder().encode(value);

    // JPEG 뒤 꼬리 바이트 — 카메라·편집기가 흔히 남긴다
    expect(validateOrgLogoContent("image/jpeg", new Uint8Array([0xff, 0xd8, 0x11, 0xff, 0xd9, 0x00])))
      .toEqual({ ok: true });

    for (const svg of [
      // XML 선언으로 시작 — 내보내기 «기본값»
      '<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
      // DOCTYPE — 오래된 내보내기
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd"><svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
      // <style> — 일러스트레이터·피그마 기본값
      '<svg xmlns="http://www.w3.org/2000/svg"><style>.a{fill:#000}</style><rect class="a"/></svg>',
      // 내부 참조 그라디언트 — 바깥으로 나가지 않는다
      '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"/></defs><rect fill="url(#g)"/></svg>',
      // 주석으로 시작
      '<!-- Generator: Figma --><svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
      // 내부 참조 use
      '<svg xmlns="http://www.w3.org/2000/svg"><defs><rect id="r"/></defs><use xlink:href="#r"/></svg>',
      // data: 이미지는 바깥으로 안 나간다
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,iVBOR"/></svg>',
    ]) {
      expect(validateOrgLogoContent("image/svg+xml", enc(svg)), svg).toEqual({ ok: true });
    }
  });

  it("accepts inert SVG and rejects active or externally referenced SVG", () => {
    expect(validateOrgLogoContent("image/svg+xml", new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>')))
      .toEqual({ ok: true });
    /*
     * ★ 넓혔다고 «위험한 것» 까지 받지 않는다. 여기가 그 선이다 —
     *   실행되는 것과 바깥으로 나가는 것.
     */
    for (const svg of [
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(https://evil.example/x)"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><use xlink:href="https://evil.example/x#a"/></svg>',
      '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><iframe/></svg>',
    ]) {
      const verdict = validateOrgLogoContent("image/svg+xml", new TextEncoder().encode(svg));
      expect(verdict.ok, svg).toBe(false);
    }
  });
});

describe("orgLogoObjectPath — 첫 폴더가 org_id 여야 한다", () => {
  it("확장자를 mime 에서 정한다", () => {
    expect(orgLogoObjectPath(ORG, "image/png", "abc")).toBe(`${ORG}/abc.png`);
    expect(orgLogoObjectPath(ORG, "image/jpeg", "abc")).toBe(`${ORG}/abc.jpg`);
    expect(orgLogoObjectPath(ORG, "image/svg+xml", "abc")).toBe(`${ORG}/abc.svg`);
  });

  it("★ 조직 id 가 uuid 가 아니면 경로를 만들지 않는다", () => {
    expect(() => orgLogoObjectPath("../other", "image/png", "abc")).toThrow();
    expect(() => orgLogoObjectPath("", "image/png", "abc")).toThrow();
  });

  it("★ 토큰으로 경로를 벗어날 수 없다", () => {
    expect(() => orgLogoObjectPath(ORG, "image/png", "../evil")).toThrow();
    expect(() => orgLogoObjectPath(ORG, "image/png", "a/b")).toThrow();
    expect(() => orgLogoObjectPath(ORG, "image/png", "")).toThrow();
  });
});

describe("orgLogoReasonFromRpcError — 권한과 장애를 구분한다 (BBE-90 규약)", () => {
  it("42501 은 권한", () => {
    expect(orgLogoReasonFromRpcError({ code: "42501" })).toBe("permission");
  });

  it("098 이 던지는 22023 사유를 각각 옮긴다", () => {
    expect(orgLogoReasonFromRpcError({ code: "22023", message: "org logo format rejected" })).toBe("bad_format");
    expect(orgLogoReasonFromRpcError({ code: "22023", message: "org logo size rejected" })).toBe("too_large");
  });

  it("모르는 오류는 «장애» 다 — 권한 문제로 위장하지 않는다", () => {
    expect(orgLogoReasonFromRpcError({ code: "XX000", message: "boom" })).toBe("unavailable");
    expect(orgLogoReasonFromRpcError(null)).toBe("unavailable");
  });
});

describe("orgLogoFailureMessage", () => {
  it("★ 모든 사유가 서로 다른 문구를 가진다 (BBE-193)", () => {
    const reasons = ["permission", "empty", "bad_format", "too_large", "upload_failed", "unavailable"] as const;
    const messages = reasons.map(orgLogoFailureMessage);
    expect(new Set(messages).size).toBe(reasons.length);
    for (const message of messages) expect(message.length).toBeGreaterThan(0);
  });
});
