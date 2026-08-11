export interface BusinessMessageKey {
  orgId: string;
  sourceEntityId: string;
  triggerColumnKey: string;
  triggerValueId: string;
  templateId: string;
  channel: "sms" | "alimtalk";
}

function part(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error("멱등키 구성 값이 비어 있어요.");
  return `${normalized.length}:${normalized}`;
}

/** 트랜잭션과 무관한 업무 단위 키다. 전화번호나 본문은 키에 포함하지 않는다. */
export function businessMessageKey(input: BusinessMessageKey): string {
  return [
    "message-v1",
    input.orgId,
    input.sourceEntityId,
    input.triggerColumnKey,
    input.triggerValueId,
    input.templateId,
    input.channel,
  ].map(part).join("|");
}
