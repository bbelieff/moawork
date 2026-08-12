/**
 * 발송 안전장치 — 계약 타입 (BBE-148).
 *
 * 목업 정본에서 출처가 «✉ 발송» 인 컬럼은 4개다
 * (신규리드: 부재 안내 · 1차 상담 안내 · 2차 확정 안내 / 리드컨택: 미팅확정 메세지).
 * 그 칸의 값을 바꾸면 **고객에게 문자가 나가고 건당 비용이 든다. 되돌릴 수 없다.**
 *
 * 이 모듈은 «화면과 확인 절차» 까지만 만든다. 실제 전송은 붙이지 않는다 —
 * BBE-30 판정으로 발송 통로는 «보존하되 활성화 금지» 다(`confirm.ts` 의 dispatch 게이트).
 *
 * 탭 화면은 만들지 않는다. 발송 칸을 쓰는 모든 탭이 이 부품을 공유한다.
 */

import type { FieldOption } from "@/lib/types";

/** 문자·알림톡 통로. `@/lib/messaging` 의 MessageChannel 과 같은 값 집합이다. */
export type SendChannel = "sms" | "alimtalk";

/**
 * 발송 컬럼 1개의 정의 — «어떤 값이 발송을 일으키는가» 가 핵심이다.
 *
 * 목업 setCell 은 `val && val!=="보내기 전" && val!=="심사 전"` 로 판정한다. 즉
 * **«아직 안 보냄» 을 뜻하는 값 목록**이 곧 안전선이다. 그 목록에 없는 값은 전부 발송이다.
 */
export interface SendColumnSpec {
  /** `board_columns.key`. 라벨은 회사가 바꿀 수 있으므로 key 로 식별한다. */
  columnKey: string;
  /** 목업 정본의 컬럼 이름. 앱 구조 팩의 라벨과 다를 수 있어 둘 다 남긴다. */
  mockupLabel: string;
  /** 이 값이면 문자가 나가지 않는다(«보내기 전» 류). 빈 값·null 은 항상 미발송이다. */
  idleValues: readonly string[];
  /** 값 → 템플릿 코드. 여기 없는 값은 `fallbackTemplateCode` 를 쓴다. */
  templateByValue?: Readonly<Record<string, string>>;
  /** `templateByValue` 에 없는 발송 값이 왔을 때 쓸 템플릿 코드. */
  fallbackTemplateCode: string;
  channel: SendChannel;
}

/** 확인 화면에 올릴 후보 1건 — 화면이 이미 들고 있는 값만 받는다. */
export interface SendTarget {
  itemId: string;
  /** 행 제목(업체명). 미리보기 변수 치환에 쓴다. */
  title: string;
  /** 연락처 원문. 형식은 여기서 검사한다. */
  phone: string | null;
  /** 미리보기 변수 치환용 추가 값(대표자명 등). 없으면 자리표시자가 남는다. */
  fields?: Readonly<Record<string, string | null>>;
}

export type SendExclusionReason =
  | "번호 없음"
  | "번호 형식 오류"
  | "수신 거부"
  | "이미 보냄";

/** 실제로 나갈 1건. 전화번호는 화면에 그대로 뿌리지 않는다(§9.2). */
export interface SendPlanTarget {
  itemId: string;
  title: string;
  /** 숫자만 남긴 번호. 화면에는 쓰지 않는다 — 발송 요청에만 실린다. */
  phoneDigits: string;
  /** 화면 표기용 가림 번호(010-1234-••••). */
  phoneMasked: string;
  /** 중복 발송 판정 키. `@/lib/messaging` 의 messageIdempotencyKey 와 같은 규칙. */
  idempotencyKey: string;
}

export interface SendPlanExclusion {
  itemId: string;
  title: string;
  reason: SendExclusionReason;
}

/**
 * 확인 화면이 필요로 하는 전부. **이 객체 없이는 발송 요청을 만들 수 없다.**
 *
 * `fingerprint` 는 «사람이 확인한 그 계획» 을 고정한다. 확인 사이에 대상이나 값이
 * 바뀌면 지문이 달라져 `confirmSend` 가 거부한다 — 확인한 것과 나가는 것이 반드시 같다.
 */
export interface SendPlan {
  orgId: string;
  boardId: string;
  columnKey: string;
  /** 화면에 뜨는 컬럼 이름(회사가 바꾼 라벨 우선). */
  columnLabel: string;
  /** 사람이 고른 값. 이 값이 발송을 일으킨다. */
  value: string;
  templateCode: string;
  channel: SendChannel;
  /** 실제로 나갈 건. */
  sendable: readonly SendPlanTarget[];
  /** 못 보내는 건 — 사유별로 셈해서 확인 화면에 따로 보여준다. */
  excluded: readonly SendPlanExclusion[];
  /** 조건에 걸린 전체 건수(= sendable + excluded). */
  requestedCount: number;
  /** 건당 비용(원). */
  unitCostKrw: number;
  /** 예상 비용(원) = 보낼 건수 × 건당. */
  estimatedCostKrw: number;
  /** 변수까지 치환된 «실제로 나갈» 첫 문장. 자리표시자가 남으면 안 된다. */
  previewText: string;
  /** 위 문장이 누구 앞으로 간 것인지(업체명). 보낼 건이 없으면 null. */
  previewFor: string | null;
  /** 값이 없어 «—» 로 나간 변수. 있으면 확인 화면이 경고한다. */
  previewMissingVariables: readonly string[];
  /** 등록된 문구가 없는 템플릿인가. 있으면 확인 화면이 «문구 없음» 을 크게 알린다. */
  previewBodyMissing: boolean;
  /** 대량이라 «건수 직접 입력» 을 요구하는가. */
  requiresTypedCount: boolean;
  /** 계획 지문. 확인과 요청을 묶는 유일한 끈이다. */
  fingerprint: string;
}

/** 사람이 확인 화면에서 실제로 한 행동. */
export interface SendConfirmation {
  planFingerprint: string;
  /** 확인 화면이 보여 준 «보낼 건수» 를 그대로 되돌려준 값. */
  acknowledgedCount: number;
  /** 대량일 때 사람이 손으로 친 건수. `requiresTypedCount` 면 필수. */
  typedCount?: number;
  actorId: string;
  actorName: string;
  /** ISO 8601. 호출자가 넘긴다(순수 함수 유지). */
  confirmedAt: string;
}

declare const SEND_REQUEST_BRAND: unique symbol;

/**
 * 발송 «요청». `confirmSend()` 만 만들 수 있다 — 객체 리터럴로는 이 타입이 되지 않는다.
 *
 * 이것이 «확인 없이는 아무 요청도 나가지 않는다» 를 타입으로 못박는 자리다.
 * 이 요청을 받는 쪽(후속 카드)은 실행 직전에 `assertDispatchAllowed()` 를 부른다.
 */
export interface SendRequest {
  readonly [SEND_REQUEST_BRAND]: true;
  orgId: string;
  boardId: string;
  columnKey: string;
  value: string;
  templateCode: string;
  channel: SendChannel;
  targets: readonly SendPlanTarget[];
  /** 확인 시점에 사람에게 보여 준 비용. 나중에 달라지면 그것은 사고다. */
  estimatedCostKrw: number;
  planFingerprint: string;
  confirmedBy: { actorId: string; actorName: string };
  confirmedAt: string;
  /** 배치 식별자 — 지문 앞 16자. 같은 확인은 같은 배치다(재시도해도 두 번 안 나간다). */
  batchKey: string;
}

/** 확인 게이트가 요청을 거부한 이유. */
export type SendRejectionReason =
  | "확인 없음"
  | "지문 불일치"
  | "건수 불일치"
  | "건수 직접 입력 필요"
  | "보낼 건 없음"
  | "발송 통로 비활성";

export type SendGateResult =
  | { ok: true; request: SendRequest }
  | { ok: false; reason: SendRejectionReason; detail: string };

/** 이력 1줄 — «언제 · 누가 · 무엇을». */
export interface SendHistoryEntry {
  occurredAt: string;
  actorId: string;
  actorName: string;
  event: "확인 요청" | "확인 취소" | "발송 요청" | "발송 차단";
  orgId: string;
  boardId: string;
  columnKey: string;
  columnLabel: string;
  value: string;
  templateCode: string;
  channel: SendChannel;
  /** 이 이력이 가리키는 건. 배치 전체면 null. */
  itemId: string | null;
  sendableCount: number;
  excludedCount: number;
  estimatedCostKrw: number;
  planFingerprint: string;
  /** 사람이 읽는 한 줄. */
  summary: string;
}

/** `planSend` 입력. */
export interface SendPlanInput {
  orgId: string;
  boardId: string;
  column: {
    key: string;
    /** 회사가 바꾼 라벨. 없으면 카탈로그의 목업 라벨을 쓴다. */
    label?: string;
    /** select 선택지 — 라벨→id 매핑 확인용(현재는 표시에만 쓴다). */
    options?: readonly FieldOption[];
  };
  /** 사람이 고른 값. */
  value: string | null;
  targets: readonly SendTarget[];
  /** 수신 거부 번호(숫자만). `messaging_opt_outs` 에서 온다. */
  optedOutPhoneDigits?: ReadonlySet<string>;
  /** 이미 보낸 건의 idempotency key. `message_outbox` 에서 온다. */
  alreadySentKeys?: ReadonlySet<string>;
  /** 건당 비용(원). 기본 22원(목업 실측). */
  unitCostKrw?: number;
  /** 미리보기에 들어갈 보내는 회사 이름 — 워크스페이스 이름에서 온다. */
  senderName: string;
}
