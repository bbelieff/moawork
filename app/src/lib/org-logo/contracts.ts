// BBE-199 회사 로고 — 화면·액션·DB 가 공유하는 계약.
//
// ★ 실패 사유를 «하나로 뭉개지 않는다». BBE-193 의 교훈: 성공·실패 표현이
//   판정 근거를 안 읽으면 그게 결함이다. 사유마다 다른 문구를 돌려준다.

export const ORG_LOGO_BUCKET = "org-logos";

/**
 * 로고 최대 용량 (#652).
 *
 * ★ 전에는 1 MiB 였다. 그런데 그 값이 **Next 서버 액션 본문 상한과 같았다.**
 *   본문 상한을 넘으면 우리 코드가 «실행되기 전에» 요청이 잘린다 —
 *   「파일이 너무 커요」라는 안내조차 못 뜨고 아무 일도 안 일어난다.
 *   디자이너가 준 로고 PNG 는 1~3 MB 가 흔해서, 사실상 대부분이 조용히 죽었다.
 *
 * 그래서 둘을 «떼어 놓는다» — 여기를 4 MiB 로 올리고 액션 본문 상한은 그보다 넉넉히 둔다
 * (app/next.config.ts). 그래야 큰 파일이 와도 «우리 문구» 가 먼저 말한다.
 *
 * 저장소 버킷의 file_size_limit 도 같이 올라가야 한다 —
 * supabase/migrations/145_issue652_org_logo_intake.sql.
 */
export const ORG_LOGO_MAX_BYTES = 4 * 1024 * 1024;

export const ORG_LOGO_ALLOWED_MIME = ["image/png", "image/jpeg", "image/svg+xml"] as const;

export type OrgLogoMime = (typeof ORG_LOGO_ALLOWED_MIME)[number];

const EXTENSION: Record<OrgLogoMime, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
};

export type OrgLogoFailureReason =
  | "permission"
  | "empty"
  | "bad_format"
  /** 확장자·MIME 은 맞는데 «내용» 이 그 형식이 아니다. */
  | "bad_content"
  /** SVG 안에 실행되는 것이 들어 있다. 이건 «못 씀» 이 아니라 «안 씀» 이다. */
  | "unsafe_svg"
  | "too_large"
  | "upload_failed"
  | "unavailable";

export type OrgLogoActionState = Readonly<{
  ok: boolean;
  message: string;
  reason?: OrgLogoFailureReason;
}>;

export const ORG_LOGO_IDLE: OrgLogoActionState = { ok: false, message: "" };

export type OrgLogoValidation =
  | { ok: true; mime: OrgLogoMime }
  | { ok: false; reason: Extract<OrgLogoFailureReason, "empty" | "bad_format" | "too_large"> };

export function isOrgLogoMime(value: unknown): value is OrgLogoMime {
  return typeof value === "string" && (ORG_LOGO_ALLOWED_MIME as readonly string[]).includes(value);
}

/**
 * 서버가 파일을 받아들일지 판정한다.
 *
 * 화면에도 accept·크기 안내가 있지만 그것은 «안내» 다. 관문은 여기와 RPC 와 DB 제약이다.
 *
 * 이 함수는 선언값·용량의 1차 관문이다. 실제 파일 바이트는
 * validateOrgLogoContent()가 별도로 확인한다. 둘 중 하나라도 실패하면 업로드하지 않는다.
 */
export function validateOrgLogoUpload(input: { mime: string; bytes: number }): OrgLogoValidation {
  if (!Number.isFinite(input.bytes) || input.bytes <= 0) return { ok: false, reason: "empty" };
  // 형식을 용량보다 먼저 본다 — 「크고 형식도 틀린」 파일은 형식 문제로 부르는 편이 고치기 쉽다.
  if (!isOrgLogoMime(input.mime)) return { ok: false, reason: "bad_format" };
  if (input.bytes > ORG_LOGO_MAX_BYTES) return { ok: false, reason: "too_large" };
  return { ok: true, mime: input.mime };
}

/** 왜 안 되는지까지 돌려준다 — 「형식이 틀렸다」와 「위험해서 안 받는다」는 고치는 법이 다르다. */
export type OrgLogoContentVerdict =
  | { ok: true }
  | { ok: false; reason: Extract<OrgLogoFailureReason, "bad_content" | "unsafe_svg"> };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function startsWithBytes(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

/** 클라이언트가 선언한 MIME이 아니라 서버가 읽은 실제 바이트를 판정한다. */
/**
 * 바깥으로 나가는 참조가 있는가.
 *
 * 허용하는 것 — `#id`(같은 문서 안) · `data:image/...`(파일 안에 들어 있다).
 * 그 밖은 전부 «나간다» 로 본다: http · 상대경로 · 프로토콜 상대(`//`) · file: 등.
 */
function hasExternalReference(svg: string): boolean {
  const attribute = /(?:xlink:)?(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/giu;
  for (const match of svg.matchAll(attribute)) {
    if (isOutwardReference(match[1] ?? match[2] ?? match[3] ?? "")) return true;
  }
  const cssUrl = /url\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\)/giu;
  for (const match of svg.matchAll(cssUrl)) {
    if (isOutwardReference(match[1] ?? match[2] ?? match[3] ?? "")) return true;
  }
  return false;
}

function isOutwardReference(rawValue: string): boolean {
  const value = rawValue.trim();
  if (!value) return false;
  if (value.startsWith("#")) return false;
  if (/^data:image\//iu.test(value)) return false;
  return true;
}

export function validateOrgLogoContent(mime: OrgLogoMime, bytes: Uint8Array): OrgLogoContentVerdict {
  if (mime === "image/png") {
    return bytes.length >= PNG_SIGNATURE.length && startsWithBytes(bytes, PNG_SIGNATURE)
      ? { ok: true }
      : { ok: false, reason: "bad_content" };
  }

  if (mime === "image/jpeg") {
    // ★ 「끝이 EOI 여야 한다」가 아니라 「EOI 가 «있어야» 한다」.
    //   꼬리 바이트는 카메라·편집기가 흔히 남기고, 무해하다.
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      return { ok: false, reason: "bad_content" };
    }
    for (let index = 2; index + 1 < bytes.length; index += 1) {
      if (bytes[index] === 0xff && bytes[index + 1] === 0xd9) return { ok: true };
    }
    return { ok: false, reason: "bad_content" };
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
  } catch {
    return { ok: false, reason: "bad_content" };
  }

  // ★ 앞에 붙는 «껍데기» 를 허용한다 — XML 선언 · DOCTYPE · 주석. 그림이 아니라 포장이다.
  //   전에는 이것 때문에 «내보내기 기본값» 이 전부 튕겼다.
  const body = text.replace(
    /^(?:﻿|\s|<\?xml[^>]*\?>|<!DOCTYPE[^>]*>|<!--[\s\S]*?-->)+/iu,
    "",
  );
  if (!/^<svg[\s>]/iu.test(body) || !/<\/svg>\s*$/iu.test(body)) {
    return { ok: false, reason: "bad_content" };
  }

  // ★ 여기부터가 «안 받는» 것이다. 못 읽는 게 아니라 위험해서 안 받는다.
  //   <style> 과 url(#내부참조) 는 위험하지 않으므로 이제 통과시킨다.
  const dangerous =
    // 실행되는 것
    /<\s*(?:script|foreignObject|iframe|object|embed|animate|set)\b/iu.test(body)
    || /\son[a-z]+\s*=/iu.test(body)
    || /javascript\s*:/iu.test(body)
    // 바깥으로 나가는 것 — 내부 참조(#id)와 data:image 는 나가지 않으므로 허용한다
    //
    // ★ 값을 «꺼내서» 본다. 전에는 ["']? 로 따옴표를 건너뛰며 lookahead 를 붙였는데,
    //   그러면 정규식이 따옴표를 «안 먹은» 자리에서도 판정해 xlink:href="#r" 같은
    //   내부 참조를 위험으로 오판했다. 실제로 시험이 그걸 잡았다.
    || hasExternalReference(body)
    // 외부 실체 — XXE
    || /<!ENTITY/iu.test(body);

  return dangerous ? { ok: false, reason: "unsafe_svg" } : { ok: true };
}

/**
 * 오브젝트 경로를 «서버가» 조립한다. 클라이언트가 경로를 정하지 못하게 하는 것이 핵심이다.
 * 첫 폴더가 org_id 여야 Storage RLS 와 RPC 와 DB CHECK 를 모두 통과한다.
 */
export function orgLogoObjectPath(orgId: string, mime: OrgLogoMime, token: string): string {
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/u.test(orgId)) {
    throw new Error("org logo path requires a uuid org id");
  }
  if (!/^[A-Za-z0-9._-]{1,64}$/u.test(token)) {
    throw new Error("org logo path requires a safe token");
  }
  return `${orgId}/${token}.${EXTENSION[mime]}`;
}

const MESSAGE: Record<OrgLogoFailureReason, string> = {
  permission: "회사 로고는 대표와 관리자만 바꿀 수 있어요.",
  empty: "파일을 선택해 주세요.",
  bad_format: "PNG · JPG · SVG 파일만 올릴 수 있어요.",
  bad_content: "파일이 깨졌거나 형식이 이름과 달라요. 다시 내보내서 올려 주세요.",
  unsafe_svg: "이 SVG 안에 스크립트나 바깥 주소가 들어 있어 쓸 수 없어요. 그림만 담긴 SVG 로 다시 내보내 주세요.",
  too_large: `파일이 너무 커요. ${Math.round(ORG_LOGO_MAX_BYTES / 1024 / 1024)}MB 이하로 올려 주세요.`,
  upload_failed: "파일을 올리지 못했어요. 잠시 뒤 다시 시도해 주세요.",
  unavailable: "회사 로고를 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.",
};

export function orgLogoFailureMessage(reason: OrgLogoFailureReason): string {
  return MESSAGE[reason];
}

/**
 * RPC 오류를 사유로 되돌린다.
 * 42501 = 권한 없음. 22023 은 108 이 형식·용량·경로를 각각 다른 message 로 던진다.
 * 그 밖은 «장애» 다 — 권한 문제로 위장하지 않는다 (lib/perm/server.ts 의 BBE-90 규약과 같은 결).
 */
export function orgLogoReasonFromRpcError(
  error: { code?: string | null; message?: string | null } | null | undefined,
): OrgLogoFailureReason {
  const code = error?.code ?? "";
  const message = error?.message ?? "";
  if (code === "42501") return "permission";
  if (message.includes("org logo format rejected")) return "bad_format";
  if (message.includes("org logo size rejected")) return "too_large";
  if (message.includes("org logo denied")) return "permission";
  return "unavailable";
}
