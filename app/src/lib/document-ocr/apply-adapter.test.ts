import { describe, expect, it, vi } from "vitest";
import {
  applyOcrResultToStates,
  buildApplyPayload,
  createDetailApplyHandler,
  defaultChecked,
  deriveOcrFieldRequestId,
  newOcrRequestId,
  type OcrFieldState,
} from "./apply-adapter";
import type { OcrProposedField } from "./types";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * 실제 SQL 영수증 의미의 최소 모사 — 호출 횟수가 아니라 제약으로 판정한다.
 * `new_lead_requests` PK(org_id, request_id) + payload/operation 묶음과 같이:
 * 같은 ID에 다른 payload가 오면 22023(영구 실패), 같은 payload면 replay 성공.
 */
function receiptBoundSaver(options: { failKeys?: Set<string> } = {}) {
  const receipts = new Map<string, string>();
  const calls: { fieldKey: string; requestId: string; value: string }[] = [];
  return {
    calls,
    saveField: async (boardKey: string, value: string, meta: { fieldKey: string; requestId: string }) => {
      calls.push({ fieldKey: String(meta.fieldKey), requestId: meta.requestId, value });
      if (options.failKeys?.has(String(meta.fieldKey))) {
        throw new Error("일시 오류(저장 실패 유도)");
      }
      const payload = JSON.stringify({ boardKey, value });
      const prior = receipts.get(meta.requestId);
      if (prior !== undefined) {
        if (prior !== payload) {
          const error = new Error("new lead idempotency key reuse");
          (error as { code?: string }).code = "22023";
          throw error;
        }
        return; // replay — 같은 의도 재시도 성공.
      }
      receipts.set(meta.requestId, payload);
    },
  };
}

function field(over: Partial<OcrProposedField> & { key: OcrProposedField["key"] }): OcrProposedField {
  return { value: "", confidence: 0.8, warnings: [], ...over };
}

function state(
  key: OcrProposedField["key"],
  value: string,
  current = "",
  over: Partial<OcrFieldState> = {},
): OcrFieldState {
  const f = field({ key, value });
  return {
    field: f,
    current,
    edited: value,
    checked: defaultChecked(f, current),
    ...over,
  };
}

const FIELD_MAP = {
  companyName: "company_name",
  bizNo: "biz_no",
  representative: "rep_name",
} as const;

describe("apply-adapter", () => {
  it("defaultChecked: 빈값·형식오류·동일값은 미선택", () => {
    expect(defaultChecked(field({ key: "companyName", value: "" }), "기존")).toBe(false);
    expect(
      defaultChecked(field({ key: "bizNo", value: "x", valid: false }), ""),
    ).toBe(false);
    expect(defaultChecked(field({ key: "companyName", value: "같음" }), "같음")).toBe(false);
    expect(defaultChecked(field({ key: "companyName", value: "다름" }), "기존")).toBe(true);
  });

  it("blank 제안은 기존값 보호로 제외하고 보고한다", () => {
    const payload = buildApplyPayload({
      states: [state("companyName", "", "기존상호", { checked: true, edited: "" })],
      fieldMap: { ...FIELD_MAP },
    });
    expect(payload.selections).toEqual([]);
    expect(payload.skippedBlank).toEqual(["companyName"]);
  });

  it("형식 오류 제안을 그대로 보내지 않고 막는다 (수정은 통과)", () => {
    const blocked = buildApplyPayload({
      states: [
        {
          field: field({ key: "bizNo", value: "123-45-67890", valid: false }),
          current: "",
          edited: "123-45-67890",
          checked: true,
        },
      ],
      fieldMap: { ...FIELD_MAP },
    });
    expect(blocked.selections).toEqual([]);
    expect(blocked.blockedInvalid).toEqual(["bizNo"]);

    const fixed = buildApplyPayload({
      states: [
        {
          field: field({ key: "bizNo", value: "123-45-67890", valid: false }),
          current: "",
          edited: "123-45-67891",
          checked: true,
        },
      ],
      fieldMap: { ...FIELD_MAP },
    });
    expect(fixed.selections).toHaveLength(1);
  });

  it("매핑 없는 키는 unmapped로 보고한다", () => {
    const payload = buildApplyPayload({
      states: [state("businessItem", "전자상거래", "", { checked: true })],
      fieldMap: { ...FIELD_MAP },
    });
    expect(payload.unmapped).toEqual(["businessItem"]);
  });

  it("부분 적용: 실패해도 나머지는 저장하고 필드 오류를 돌린다", async () => {
    const calls: string[] = [];
    const handler = createDetailApplyHandler({
      fieldMap: { ...FIELD_MAP },
      saveField: async (boardKey, value) => {
        calls.push(boardKey);
        if (boardKey === "biz_no") throw new Error("권한 없음");
        void value;
      },
    });
    const result = await handler({
      requestId: "req-1",
      selections: [
        { fieldKey: "companyName", value: "(주)가상상회" },
        { fieldKey: "bizNo", value: "123-45-67891" },
      ],
    });
    expect(result.ok).toBe(false);
    expect(calls).toEqual(["company_name", "biz_no"]);
    expect(result.fieldErrors.companyName).toBeUndefined();
    expect(result.fieldErrors.bizNo).toBe("권한 없음");
  });

  it("전체 성공이면 ok + 오류 없음", async () => {
    const saveField = vi.fn(async () => undefined);
    const handler = createDetailApplyHandler({ saveField, fieldMap: { ...FIELD_MAP } });
    const result = await handler({
      requestId: "req-2",
      selections: [{ fieldKey: "representative", value: "홍길동" }],
    });
    expect(result.ok).toBe(true);
    // base ID 공용이 아니라 필드별 안정 ID를 전달한다 (SQL 영수증 충돌 방지).
    expect(saveField).toHaveBeenCalledWith(
      "rep_name",
      "홍길동",
      expect.objectContaining({
        requestId: deriveOcrFieldRequestId("req-2", "representative", "rep_name", "홍길동"),
        fieldKey: "representative",
      }),
    );
  });

  it("명시 확정 없이 체크된 사업자번호는 unconfirmed로 빼고 보내지 않는다", () => {
    const map = { bizNo: "biz_no" };
    const checked = state("bizNo", "123-45-67891", "", {
      checked: true,
      needsConfirm: true,
      confirmed: false,
    });
    const held = buildApplyPayload({ states: [checked], fieldMap: { ...map } });
    expect(held.selections).toEqual([]);
    expect(held.unconfirmed).toEqual(["bizNo"]);

    const confirmed = state("bizNo", "123-45-67891", "", {
      checked: true,
      needsConfirm: true,
      confirmed: true,
    });
    const sent = buildApplyPayload({ states: [confirmed], fieldMap: { ...map } });
    expect(sent.selections).toHaveLength(1);
    expect(sent.selections[0].confirmed).toBe(true);
    expect(sent.unconfirmed).toEqual([]);
  });

  it("선택 불가(미지원) 행은 체크돼도 payload에 넣지 않는다", () => {
    const payload = buildApplyPayload({
      states: [
        {
          ...state("companyName", "(주)가상상회", "", { checked: true }),
          disabled: true,
          disabledReason: "상호는 행 제목이라 저장하지 않습니다.",
        },
      ],
      fieldMap: { ...FIELD_MAP },
    });
    expect(payload.selections).toEqual([]);
    expect(payload.unmapped).toEqual([]);
  });

  it("applyOcrResultToStates: 성공분 선택 해제+기존값 갱신, 실패 초안 유지", () => {
    const states: OcrFieldState[] = [
      { ...state("representative", "홍길동", "김철수", { checked: true }), edited: "홍길동" },
      { ...state("companyName", "(주)가상상회", "", { checked: true }), edited: "(주)가상상회" },
    ];
    const next = applyOcrResultToStates(
      states,
      { representative: "홍길동" },
      { companyName: "권한 없음" },
    );
    const ok = next.find((s) => s.field.key === "representative");
    expect(ok?.checked).toBe(false);
    expect(ok?.current).toBe("홍길동");
    const failed = next.find((s) => s.field.key === "companyName");
    expect(failed?.checked).toBe(true);
    expect(failed?.edited).toBe("(주)가상상회");
    expect(failed?.current).toBe("");
  });

  it("동일 의도 재시도는 필드별 안정 ID를 그대로 전달한다", async () => {
    const seen: string[] = [];
    const handler = createDetailApplyHandler({
      fieldMap: { ...FIELD_MAP },
      saveField: async (_boardKey, _value, meta) => {
        seen.push(meta.requestId);
        throw new Error("일시 오류");
      },
    });
    const request = {
      requestId: "stable-req",
      selections: [{ fieldKey: "representative" as const, value: "홍길동" }],
    };
    await handler(request);
    await handler(request);
    const expected = deriveOcrFieldRequestId("stable-req", "representative", "rep_name", "홍길동");
    expect(seen).toEqual([expected, expected]);
    expect(UUID.test(expected)).toBe(true);
  });

  it("newOcrRequestId는 호출마다 다른 값을 만든다", () => {
    const ids = new Set([newOcrRequestId(), newOcrRequestId(), newOcrRequestId()]);
    expect(ids.size).toBe(3);
  });
});

describe("deriveOcrFieldRequestId — SQL 영수증 충돌 방지", () => {
  it("같은 입력이면 같은 UUID, 필드·대상·값이 다르면 다른 UUID", () => {
    const base = "base-intent-1";
    const a = deriveOcrFieldRequestId(base, "representative", "rep_name", "홍길동");
    expect(UUID.test(a)).toBe(true);
    expect(deriveOcrFieldRequestId(base, "representative", "rep_name", "홍길동")).toBe(a);
    // 필드가 다르면 충돌 없음 (대표자 vs 주소 vs 개업연월).
    expect(deriveOcrFieldRequestId(base, "businessAddress", "address_detail", "홍길동")).not.toBe(a);
    expect(deriveOcrFieldRequestId(base, "openedOn", "founded_month", "홍길동")).not.toBe(a);
    // 같은 필드라도 값이 바뀌면(편집·새 의도) 새 ID.
    expect(deriveOcrFieldRequestId(base, "representative", "rep_name", "김철수")).not.toBe(a);
    // 같은 값이라도 대상 동작이 다르면(title vs 정본 필드 vs meta) 충돌 없음.
    expect(deriveOcrFieldRequestId(base, "companyName", "title", "홍길동")).not.toBe(a);
    // base 세션이 다르면 전부 다름.
    expect(deriveOcrFieldRequestId("base-intent-2", "representative", "rep_name", "홍길동")).not.toBe(a);
  });

  it("base ID 공용(구 동작)은 두 번째 필드부터 22023 영구 실패한다", async () => {
    // 구 동작 재현: 모든 필드에 같은 requestId를 그대로 전달.
    const saver = receiptBoundSaver();
    const legacy = async (requestId: string, selections: { fieldKey: string; boardKey: string; value: string }[]) => {
      const errors: Record<string, string> = {};
      for (const s of selections) {
        try {
          await saver.saveField(s.boardKey, s.value, { fieldKey: s.fieldKey, requestId });
        } catch (error) {
          errors[s.fieldKey] = error instanceof Error ? error.message : "실패";
        }
      }
      return errors;
    };
    const selections = [
      { fieldKey: "representative", boardKey: "rep_name", value: "홍길동" },
      { fieldKey: "businessAddress", boardKey: "address_detail", value: "서울" },
    ];
    const errors = await legacy("same-base-id", selections);
    expect(Object.keys(errors)).toEqual(["businessAddress"]);
    expect(errors.businessAddress).toMatch(/idempotency key reuse/);
    // 같은 ID로 재시도해도 영구 실패 (payload가 다르므로 replay 불가).
    const retry = await legacy("same-base-id", [selections[1]]);
    expect(Object.keys(retry)).toEqual(["businessAddress"]);
  });

  it("다중 필드(대표자/주소/개업연월) 성공 + 실패분만 재시도", async () => {
    const saver = receiptBoundSaver({ failKeys: new Set(["businessAddress"]) });
    const fieldMap = {
      representative: "rep_name",
      businessAddress: "address_detail",
      openedOn: "founded_month",
    } as const;
    const handler = createDetailApplyHandler({ fieldMap: { ...fieldMap }, saveField: saver.saveField });
    const base = "multi-field-intent";
    const selections = [
      { fieldKey: "representative" as const, value: "홍길동" },
      { fieldKey: "businessAddress" as const, value: "서울 강남" },
      { fieldKey: "openedOn" as const, value: "2024-03" },
    ];
    const first = await handler({ requestId: base, selections });
    expect(first.ok).toBe(false);
    expect(Object.keys(first.fieldErrors)).toEqual(["businessAddress"]);
    // 세 필드가 서로 다른 안정 ID를 받았다 (영수증 3건, 충돌 없음).
    const ids = saver.calls.map((c) => c.requestId);
    expect(new Set(ids).size).toBe(3);

    // 실패분만 같은 값으로 재시도 → 같은 파생 ID → replay/신규 성공.
    saver.calls.length = 0;
    const retrySaver = receiptBoundSaver();
    // 기존 영수증을 이어받는다 (서버에 이미 남은 성공분).
    for (const c of [
      { fieldKey: "representative", requestId: deriveOcrFieldRequestId(base, "representative", "rep_name", "홍길동"), value: "홍길동" },
      { fieldKey: "openedOn", requestId: deriveOcrFieldRequestId(base, "openedOn", "founded_month", "2024-03"), value: "2024-03" },
    ]) {
      await retrySaver.saveField(
        c.fieldKey === "representative" ? "rep_name" : "founded_month",
        c.value,
        { fieldKey: c.fieldKey, requestId: c.requestId },
      );
    }
    const retryHandler = createDetailApplyHandler({
      fieldMap: { ...fieldMap },
      saveField: retrySaver.saveField,
    });
    const retry = await retryHandler({
      requestId: base,
      selections: [{ fieldKey: "businessAddress", value: "서울 강남" }],
    });
    expect(retry.ok).toBe(true);
    expect(retry.fieldErrors.businessAddress).toBeUndefined();
    const addrCall = retrySaver.calls.find((c) => c.fieldKey === "businessAddress");
    expect(addrCall?.requestId).toBe(
      deriveOcrFieldRequestId(base, "businessAddress", "address_detail", "서울 강남"),
    );
  });
});
