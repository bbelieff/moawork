/**
 * 발송 계획 — 확인 화면에 올릴 재료를 만든다 (BBE-148).
 *
 * 이 단계는 **아무것도 보내지 않는다.** 「누구에게 · 몇 건 · 무슨 문구 · 얼마」를 계산해
 * 사람이 볼 수 있게 만드는 것이 전부다. 실제 요청은 `confirm.ts` 가 사람의 확인을 받은
 * 뒤에만 만든다.
 */

import { createHash } from "node:crypto";
import { messageIdempotencyKey, phoneDigits } from "@/lib/messaging";
import { resolveSendColumn, templateCodeForValue, valueTriggersSend } from "./catalog";
import { renderTemplate } from "./template";
import type {
  SendPlan,
  SendPlanExclusion,
  SendPlanInput,
  SendPlanTarget,
} from "./types";

/** 목업 실측 단가. 회사가 통로를 붙이면 실제 단가로 덮는다. */
export const DEFAULT_UNIT_COST_KRW = 22;

/**
 * 이 건수부터 «건수 직접 입력» 을 요구한다.
 *
 * 1건은 그 건의 이름과 문구가 확인 화면에 그대로 보이므로 확인 한 번으로 충분하다.
 * 2건부터는 사람이 «몇 건인지» 를 눈으로 세지 않고 넘길 수 있어 한 겹을 더 건다.
 */
export const TYPED_COUNT_THRESHOLD = 2;

/**
 * 번호를 화면에 그대로 뿌리지 않는다 — 뒤 4자리를 가린다(§9.2).
 * 앞자리 묶음은 흔한 두 형태(휴대폰 3-4-4 · 서울 02-4-4)만 맞추고, 나머지는 나누지 않는다.
 */
export function maskPhone(digits: string): string {
  const masked = "••••";
  if (digits.length <= 4) return "•".repeat(digits.length);
  const head = digits.slice(0, digits.length - 4);
  if (head.length === 7) return `${head.slice(0, 3)}-${head.slice(3)}-${masked}`;
  if (head.startsWith("02") && head.length === 6) return `02-${head.slice(2)}-${masked}`;
  return `${head}-${masked}`;
}

/** `@/lib/messaging` 의 예약 규칙과 같은 한도. 여기서 미리 걸러 확인 화면에 사유로 보여준다. */
function phoneIsSendable(digits: string): boolean {
  return digits.length >= 9 && digits.length <= 12;
}

/**
 * 계획 지문 — 사람이 확인한 «그 계획» 을 고정한다.
 *
 * 대상·값·템플릿·비용이 하나라도 달라지면 지문이 달라지고, 그러면 `confirmSend` 가
 * 요청 만들기를 거부한다. 확인 화면과 실제로 나가는 것이 어긋날 길을 막는 장치다.
 */
export function planFingerprint(parts: {
  orgId: string;
  boardId: string;
  columnKey: string;
  value: string;
  templateCode: string;
  itemIds: readonly string[];
  estimatedCostKrw: number;
}): string {
  return createHash("sha256")
    .update(
      [
        parts.orgId,
        parts.boardId,
        parts.columnKey,
        parts.value,
        parts.templateCode,
        String(parts.estimatedCostKrw),
        [...parts.itemIds].sort().join(","),
      ].join(""),
    )
    .digest("hex");
}

/**
 * 확인 화면 재료를 만든다. 발송 칸이 아니거나 발송을 일으키지 않는 값이면 `null` —
 * 호출자는 그때 평소대로 셀을 저장하면 된다.
 */
export function planSend(input: SendPlanInput): SendPlan | null {
  const spec = resolveSendColumn(input.column);
  if (!spec) return null;
  if (!valueTriggersSend(spec, input.value)) return null;

  const value = (input.value as string).trim();
  const templateCode = templateCodeForValue(spec, value);
  const unitCostKrw = input.unitCostKrw ?? DEFAULT_UNIT_COST_KRW;
  const optedOut = input.optedOutPhoneDigits ?? new Set<string>();
  const alreadySent = input.alreadySentKeys ?? new Set<string>();

  const sendable: SendPlanTarget[] = [];
  const excluded: SendPlanExclusion[] = [];

  for (const target of input.targets) {
    const digits = phoneDigits(target.phone ?? "");
    if (digits === "") {
      excluded.push({ itemId: target.itemId, title: target.title, reason: "번호 없음" });
      continue;
    }
    if (!phoneIsSendable(digits)) {
      excluded.push({ itemId: target.itemId, title: target.title, reason: "번호 형식 오류" });
      continue;
    }
    if (optedOut.has(digits)) {
      excluded.push({ itemId: target.itemId, title: target.title, reason: "수신 거부" });
      continue;
    }
    const idempotencyKey = messageIdempotencyKey({
      orgId: input.orgId,
      entityId: target.itemId,
      columnKey: spec.columnKey,
      value,
    });
    if (alreadySent.has(idempotencyKey)) {
      excluded.push({ itemId: target.itemId, title: target.title, reason: "이미 보냄" });
      continue;
    }
    sendable.push({
      itemId: target.itemId,
      title: target.title,
      phoneDigits: digits,
      phoneMasked: maskPhone(digits),
      idempotencyKey,
    });
  }

  const first = input.targets.find((t) => t.itemId === sendable[0]?.itemId) ?? null;
  const preview = renderTemplate(templateCode, {
    보내는회사: input.senderName,
    업체명: first?.title ?? null,
    대표자명: first?.fields?.["대표자명"] ?? null,
  });

  const estimatedCostKrw = sendable.length * unitCostKrw;

  return {
    orgId: input.orgId,
    boardId: input.boardId,
    columnKey: spec.columnKey,
    columnLabel: input.column.label ?? spec.mockupLabel,
    value,
    templateCode,
    channel: spec.channel,
    sendable,
    excluded,
    requestedCount: input.targets.length,
    unitCostKrw,
    estimatedCostKrw,
    previewText: preview.text,
    previewFor: first?.title ?? null,
    previewMissingVariables: preview.missingVariables,
    previewBodyMissing: preview.bodyMissing,
    requiresTypedCount: sendable.length >= TYPED_COUNT_THRESHOLD,
    fingerprint: planFingerprint({
      orgId: input.orgId,
      boardId: input.boardId,
      columnKey: spec.columnKey,
      value,
      templateCode,
      itemIds: sendable.map((t) => t.itemId),
      estimatedCostKrw,
    }),
  };
}

/** 확인 화면이 사유별로 셈해 보여줄 제외 건수. */
export function exclusionCounts(plan: SendPlan): { reason: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of plan.excluded) {
    counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1);
  }
  return [...counts.entries()].map(([reason, count]) => ({ reason, count }));
}
