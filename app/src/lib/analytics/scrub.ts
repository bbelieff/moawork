// PII 스크러빙 — 이벤트가 PostHog 로 나가기 **전에** 개인정보를 제거한다.
//
// 규약
//  1. 순수 함수만 둔다. 브라우저 API·SDK·환경변수 의존 0 → 서버/클라이언트/테스트 어디서나 동일.
//  2. 입력을 변형하지 않는다(always copy). 호출부가 원본을 계속 쓸 수 있어야 한다.
//  3. **fail-closed**: 판단이 서지 않으면 남기지 말고 지운다.
//  4. 스크러빙은 "방어선 1개" 가 아니다. 키 기반(민감 키 통째 마스킹) + 값 기반(문자열 패턴)
//     + URL 기반(쿼리·해시 전면 제거) 세 겹을 모두 적용한다.
//
// 여기서 지우는 것: 이메일 · 전화 · 주민등록번호 · 사업자등록번호 · 카드번호 · 계좌 · IP ·
//                   토큰(JWT/Bearer) · 사람 이름으로 명시된 키.
// 여기서 남기는 것: uuid/보드 id 같은 내부 식별자, 이벤트 이름, 화면 경로, 숫자 지표.
//                   (내부 식별자는 PostHog 밖에서 조인해야 의미가 생기므로 PII 로 보지 않는다.)

import { analyticsRouteTemplate } from "./events";

export const REDACTED = "[redacted]";

/** 값 기반 패턴. 순서가 의미를 갖는다 — 더 구체적인 형식을 먼저 지운다. */
const VALUE_PATTERNS: ReadonlyArray<{ re: RegExp; tag: string }> = [
  // JWT — eyJ 로 시작하는 3-파트. 다른 패턴이 조각내기 전에 먼저 지운다.
  { re: /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g, tag: "token" },
  { re: /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, tag: "token" },
  // 이메일
  { re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, tag: "email" },
  // 주민등록번호 — 6자리 + 성별코드(1~4) + 6자리
  { re: /\b\d{6}\s?-\s?[1-4]\d{6}\b/g, tag: "rrn" },
  // 사업자등록번호 — 3-2-5
  { re: /\b\d{3}-\d{2}-\d{5}\b/g, tag: "brn" },
  // 카드번호 — 4-4-4-4 (구분자 없거나 - 또는 공백)
  { re: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, tag: "card" },
  // 휴대전화 — 010-1234-5678, +82 10 1234 5678 등
  { re: /(?:\+?82[\s-]?)?\b01[016789][\s-]?\d{3,4}[\s-]?\d{4}\b/g, tag: "phone" },
  // 유선전화 — 02-123-4567, 031-123-4567
  { re: /\b0(?:2|[3-6][1-5])[\s-]?\d{3,4}[\s-]?\d{4}\b/g, tag: "phone" },
  // IPv4
  { re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g, tag: "ip" },
];

/**
 * 키 이름만 보고 값을 통째로 지우는 목록.
 * 부분일치라서 오탐이 없도록 **모호하지 않은 조각만** 넣는다.
 * (예: "auth" 는 "author" 를 잡으므로 넣지 않고 "authorization" 만 넣는다.)
 */
const SENSITIVE_KEY_PARTS: readonly string[] = [
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "api_key",
  "authorization",
  "credential",
  "cookie",
  "session_id",
  "otp",
  "email",
  "e_mail",
  "search",
  "query",
  "customer",
  "company_name",
  "phone",
  "mobile",
  "card_number",
  "cardnumber",
  "ssn",
  "birthday",
  "birthdate",
  "주민",
  "사업자",
  "계좌",
  "카드번호",
  "비밀번호",
  "연락처",
  "전화",
  "이메일",
];

/**
 * 정확히 일치할 때만 지우는 키.
 * `name` 은 board_name·column_name 처럼 업무 데이터에도 흔해서 부분일치로 다루지 않는다.
 * "사람 이름" 이 분명한 키만 여기 둔다.
 */
const SENSITIVE_KEY_EXACT: ReadonlySet<string> = new Set([
  "name",
  "username",
  "user_name",
  "full_name",
  "fullname",
  "first_name",
  "last_name",
  "display_name",
  "contact_name",
  "customer_name",
  "owner_name",
  "address",
  "addr",
  "이름",
  "성명",
  "고객명",
  "담당자",
  "주소",
]);

/** 재귀 폭주와 페이로드 비대를 막는 상한. 넘으면 잘라내고 표식을 남긴다. */
const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 100;
const MAX_STRING_LENGTH = 2000;

/** 키를 비교 가능한 형태로 정규화한다: 소문자 + 구분자 통일. */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[\s.\-[\]]+/g, "_");
}

export function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (SENSITIVE_KEY_EXACT.has(normalized)) return true;
  // PostHog 예약 접두사($, __)를 떼고도 한 번 본다: "$email" → "email"
  const bare = normalized.replace(/^[$_]+/, "");
  if (SENSITIVE_KEY_EXACT.has(bare)) return true;
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}

/**
 * 문자열 안의 PII 를 패턴으로 지운다.
 * 원문 전체를 버리지 않는 이유: "결제 실패: card 4111-1111-1111-1111" 같은 메시지에서
 * 진단에 필요한 문맥은 남기고 값만 지우는 편이 실제로 쓸모 있기 때문이다.
 */
export function scrubText(input: string): string {
  const clipped =
    input.length > MAX_STRING_LENGTH
      ? `${input.slice(0, MAX_STRING_LENGTH)}…[truncated]`
      : input;

  return VALUE_PATTERNS.reduce(
    (acc, { re, tag }) => acc.replace(new RegExp(re.source, re.flags), `[redacted:${tag}]`),
    clipped,
  );
}

/**
 * URL 스크러빙.
 *  - 쿼리와 해시: 값의 안전성을 추론하지 않고 전부 버린다.
 *  - 경로: 유한 pathname template으로 바꿔 slug/id/자유문자열을 제거한다.
 * 파싱 불가 입력은 문자열 스크러빙으로 처리한다.
 */
export function scrubUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return scrubText(raw);
  }

  url.pathname = analyticsRouteTemplate(url.pathname);
  url.search = "";
  url.hash = "";

  return url.toString();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

/** PostHog 가 URL 로 다루는 예약 프로퍼티 — scrubUrl 로 처리한다. */
const URL_PROPERTY_KEYS: ReadonlySet<string> = new Set([
  "$current_url",
  "$referrer",
  "$initial_current_url",
  "$initial_referrer",
  "$initial_referring_domain",
  "$session_entry_url",
]);

const SNAPSHOT_URL_ATTRIBUTE_KEYS: ReadonlySet<string> = new Set([
  "href",
  "src",
  "action",
  "formaction",
  "poster",
  "xlink:href",
]);

const SNAPSHOT_ATTRIBUTE_KEYS: ReadonlySet<string> = new Set(["attributes", "$attributes"]);

const PATH_PROPERTY_KEYS: ReadonlySet<string> = new Set([
  "$pathname",
  "$prev_pageview_pathname",
  "$session_entry_pathname",
  "$initial_pathname",
]);

function isSnapshotUrlAttribute(key: string): boolean {
  return SNAPSHOT_URL_ATTRIBUTE_KEYS.has(normalizeKey(key));
}

function isSnapshotAttributeKey(key: string): boolean {
  return SNAPSHOT_ATTRIBUTE_KEYS.has(normalizeKey(key));
}

function scrubSnapshotPath(raw: string): string {
  try {
    const url = new URL(raw, "https://analytics.invalid");
    if (url.protocol !== "http:" && url.protocol !== "https:") return REDACTED;
    return analyticsRouteTemplate(url.pathname);
  } catch {
    return REDACTED;
  }
}

function scrubSnapshotAttributes(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return REDACTED;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= MAX_DEPTH) return REDACTED;

  if (Array.isArray(value)) {
    return value.map((item) => scrubSnapshotAttributes(item, depth + 1));
  }

  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (isSensitiveKey(key)) out[key] = REDACTED;
      else if (typeof child === "string" && isSnapshotUrlAttribute(key)) {
        out[key] = scrubSnapshotPath(child);
      } else out[key] = scrubSnapshotAttributes(child, depth + 1);
    }
    return out;
  }

  return REDACTED;
}

function scrubSnapshotValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return REDACTED;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= MAX_DEPTH) return REDACTED;

  if (Array.isArray(value)) {
    return value.map((item) => scrubSnapshotValue(item, depth + 1));
  }

  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (isSensitiveKey(key)) out[key] = REDACTED;
      else if (isSnapshotAttributeKey(key)) {
        out[key] = scrubSnapshotAttributes(child, depth + 1);
      } else if (typeof child === "string" && isSnapshotUrlAttribute(key)) {
        out[key] = scrubSnapshotPath(child);
      } else out[key] = scrubSnapshotValue(child, depth + 1);
    }
    return out;
  }

  return REDACTED;
}

/**
 * 임의 값 재귀 스크러빙.
 * - 민감 키: 값 종류와 무관하게 통째로 `[redacted]`.
 * - 문자열: 패턴 스크러빙.
 * - 배열/객체: 상한까지 재귀.
 * - Date: ISO 문자열. 그 밖의 클래스 인스턴스는 신원을 알 수 없으므로 마스킹(fail-closed).
 */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") return scrubText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;

  if (depth >= MAX_DEPTH) return "[depth-limit]";

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => scrubValue(item, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) {
      items.push(`…[${value.length - MAX_ARRAY_ITEMS} more]`);
    }
    return items;
  }

  if (value instanceof Date) return value.toISOString();

  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (isSensitiveKey(key)) {
        out[key] = REDACTED;
        continue;
      }
      if (key === "$snapshot") {
        out[key] = scrubSnapshotValue(child, depth + 1);
        continue;
      }
      if (typeof child === "string" && URL_PROPERTY_KEYS.has(key)) {
        out[key] = scrubUrl(child);
        continue;
      }
      if (typeof child === "string" && PATH_PROPERTY_KEYS.has(key)) {
        out[key] = analyticsRouteTemplate(child);
        continue;
      }
      out[key] = scrubValue(child, depth + 1);
    }
    return out;
  }

  // function·Symbol·Map·Set·클래스 인스턴스 등 — 내용을 보증할 수 없다.
  return REDACTED;
}

/** 이벤트 프로퍼티 한 덩어리를 스크러빙한다. PostHog `sanitize_properties` 계약과 맞는 형태. */
export function scrubProperties(
  properties: Record<string, unknown> | undefined | null,
): Record<string, unknown> {
  if (!properties) return {};
  return scrubValue(properties, 0) as Record<string, unknown>;
}

/**
 * PostHog `before_send` 로 들어오는 이벤트의 최소 구조(SDK 타입에 결합하지 않는다).
 * 인덱스 시그니처를 두지 않는 이유: SDK 의 `CaptureResult` 는 interface 라
 * 암시적 인덱스 시그니처를 얻지 못해 제네릭 제약을 통과하지 못한다.
 * 나머지 필드(uuid·timestamp 등)는 spread 로 그대로 넘어간다.
 */
export type ScrubbableEvent = {
  event: string;
  properties?: Record<string, unknown> | null;
  $set?: Record<string, unknown> | null;
  $set_once?: Record<string, unknown> | null;
};

/**
 * 최종 방어선. `before_send` 에 걸어 **모든** 전송 이벤트를 통과시킨다.
 * null 을 그대로 돌려주면 PostHog 는 그 이벤트를 버린다(체인 규약).
 */
export function scrubEvent<T extends ScrubbableEvent>(event: T | null): T | null {
  if (!event) return null;

  const next: ScrubbableEvent = { ...event, event: event.event };
  next.properties = scrubProperties(event.properties);
  if (event.$set) next.$set = scrubProperties(event.$set);
  if (event.$set_once) next.$set_once = scrubProperties(event.$set_once);

  return next as T;
}
