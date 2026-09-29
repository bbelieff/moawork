import { describe, expect, it } from "vitest";
import { blankChecklist } from "./checklist";
import { ConsultationError } from "./errors";
import {
  consultationErrorFromRpc,
  readHandoffReadiness,
  requestHandoff,
  setConsultationMode,
} from "./service";
import type { ConsultationRpcClient } from "./supabaseConsultation";

/**
 * 서비스 매퍼 테스트 — DB 동작을 흉내 내지 않는다.
 * CAS·replay·순차 판정은 151 RPC 정본이며 consultation.pglite.test.ts 가
 * PGlite 에서 증명한다. 여기서는 SQL errcode → 입력 보존형 에러,
 * 성공 행 → 버전/replay 전달, 인계 버전 확인만 잰다.
 */

const ORG = "00000000-0000-4000-8000-000000000001";
const ITEM = "00000000-0000-4000-8000-000000000031";
const DEAL = "00000000-0000-4000-8000-000000000040";
const REQUEST = "00000000-0000-4000-8000-000000000099";


function snapshotRow(overrides: Record<string, unknown> = {}) {
  return {
    item_id: ITEM,
    deal_id: DEAL,
    company_id: null,
    board_source: "core.default-tab/contact",
    mode: "remote",
    version: 4,
    meeting_at: "2026-10-01T10:00:00+09:00",
    // ★ 167: 과거 4단계 체크리스트는 준비도에 쓰지 않는다 — 빈 기록이어도 DB ready 를 따른다.
    checklist: blankChecklist(),
    ready: true,
    missing: [],
    seal_approved: true,
    seal_detail: "대표 직인 승인 완료",
    deal_stage_kind: "meeting",
    ...overrides,
  };
}

function clientWith(
  handler: (name: string, args: Record<string, unknown>) => unknown,
): ConsultationRpcClient {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => ({ data: handler(name, args), error: null }),
  };
}

function failingClient(code: string, message: string): ConsultationRpcClient {
  return {
    rpc: async () => ({ data: null, error: { message, code } }),
  };
}


async function capture(promise: Promise<unknown>): Promise<ConsultationError> {
  try {
    await promise;
    throw new Error("expected rejection");
  } catch (error) {
    if (error instanceof ConsultationError) return error;
    throw error;
  }
}

describe("상담 서비스 매퍼", () => {
  const modeInput = {
    orgId: ORG,
    itemId: ITEM,
    from: "remote" as const,
    to: "inperson" as const,
    meetingAt: "2026-10-01T10:00:00+09:00",
    assigneeId: "user-1",
    requestId: REQUEST,
    expectedVersion: 0,
  };

  it("성공 행을 버전·replay 그대로 돌려준다", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const client = clientWith((_name, args) => {
      calls.push(args);
      return [{ item_id: ITEM, deal_id: DEAL, company_id: null, mode: "inperson", version: 1, replayed: false }];
    });
    const result = await setConsultationMode(client, modeInput);
    expect(result).toMatchObject({ itemId: ITEM, version: 1, replayed: false });
    // ★ 167: 남은 151 쓰기는 mode 뿐이다(check 퇴역).
    expect(calls[0]).toMatchObject({ p_action: "mode", p_step: null, p_confirmed: null });
  });

  it("40001 을 입력 보존형 conflict 로 바꾼다", async () => {
    const failed = await capture(setConsultationMode(failingClient("40001", "consultation version conflict"), modeInput));
    expect(failed).toBeInstanceOf(ConsultationError);
    expect(failed.code).toBe("conflict");
    expect(failed.field).toBe("version");
  });

  it("167: 계약금 미완 직인·인계 거부를 contract_fee_required 로 돌려준다", () => {
    const failed = consultationErrorFromRpc(
      Object.assign(new Error("consultation contract fee required"), { code: "22023" }),
      { itemId: ITEM },
    );
    expect(failed.code).toBe("contract_fee_required");
    expect(failed.message).toBe("계약금 입금 확인이 필요합니다.");
    expect(failed.field).toBe("contractFee");
    expect(failed.echo).toEqual({ itemId: ITEM });
  });

  it("멱등 재사용은 requestId 필드로 돌려준다", async () => {
    const failed = await capture(setConsultationMode(failingClient("22023", "consultation idempotency key reuse"), modeInput));
    expect(failed.code).toBe("invalid_request");
    expect(failed.field).toBe("requestId");
  });

  it("42501 을 not_allowed 로 돌려준다", async () => {
    const failed = await capture(setConsultationMode(failingClient("42501", "consultation permission denied"), modeInput));
    expect(failed.code).toBe("not_allowed");
  });

  it("모드 회의 누락은 meetingAt 필드+echo 로 돌려준다", async () => {
    const client = failingClient("22023", "consultation schedule meeting required");
    const failed = await capture(setConsultationMode(client, {
      orgId: ORG,
      itemId: ITEM,
      from: "remote",
      to: "inperson",
      meetingAt: null,
      assigneeId: "user-1",
      requestId: REQUEST,
      expectedVersion: 0,
    }));
    expect(failed.code).toBe("validation");
    expect(failed.field).toBe("meetingAt");
    expect(failed.echo).toMatchObject({ meetingAt: null, assigneeId: "user-1" });
  });

  it("임의 담당자 변경은 assigneeId 필드로 돌려준다", async () => {
    const client = failingClient("22023", "consultation assignee change requires lineage");
    const failed = await capture(setConsultationMode(client, {
      orgId: ORG,
      itemId: ITEM,
      from: "remote",
      to: "inperson",
      meetingAt: "2026-10-01T10:00:00+09:00",
      assigneeId: "user-9",
      requestId: REQUEST,
      expectedVersion: 0,
    }));
    expect(failed.code).toBe("validation");
    expect(failed.field).toBe("assigneeId");
    expect(failed.echo).toMatchObject({ assigneeId: "user-9" });
  });

  it("신규리드 모드 전이는 stage_contract 로 막는다(RPC 호출 없음)", async () => {
    let called = 0;
    const client = clientWith(() => {
      called += 1;
      return [];
    });
    const failed = await capture(setConsultationMode(client, {
      orgId: ORG,
      itemId: ITEM,
      from: "new_lead",
      to: "remote",
      meetingAt: "2026-10-01T10:00:00+09:00",
      assigneeId: "user-1",
      requestId: REQUEST,
      expectedVersion: 0,
    }));
    expect(failed.code).toBe("stage_contract");
    expect(called).toBe(0);
  });

  it("준비 완료 스냅샷은 nextAction 을 돌려준다", async () => {
    const client = clientWith(() => [snapshotRow()]);
    const readiness = await readHandoffReadiness(client, { orgId: ORG, itemId: ITEM });
    expect(readiness.ready).toBe(true);
    expect(readiness.nextAction).toEqual({ kind: "contact_to_work", dealId: DEAL, sourceItemId: ITEM });
    expect(readiness.missing).toEqual([]);
  });

  it("미완료 스냅샷은 남은 항목을 그대로 돌려준다", async () => {
    const client = clientWith(() => [snapshotRow({ ready: false, missing: ["계약금 입금 확인"] })]);
    const readiness = await readHandoffReadiness(client, { orgId: ORG, itemId: ITEM });
    expect(readiness.ready).toBe(false);
    expect(readiness.nextAction).toBeNull();
    expect(readiness.missing).toContain("계약금 입금 확인");
  });

  it("낡은 버전 인계는 파이프라인 호출 없이 conflict 로 막는다", async () => {
    const client = clientWith(() => [snapshotRow({ version: 5 })]);
    let pipelineCalled = 0;
    const pipeline = {
      rpc: async () => {
        pipelineCalled += 1;
        return { data: null, error: null };
      },
    };
    const failed = await capture(requestHandoff(client, pipeline, {
      orgId: ORG,
      itemId: ITEM,
      requestId: REQUEST,
      expectedVersion: 4,
    }));
    expect(failed.code).toBe("conflict");
    expect(pipelineCalled).toBe(0);
  });

  it("미완료 인계는 replay 확인 뒤 handoff_blocked 로 막는다(F6: 유실 응답 replay 우선)", async () => {
    const client = clientWith(() => [snapshotRow({ ready: false, missing: ["계약금 입금 확인"] })]);
    let pipelineCalled = 0;
    let pipelineArgs: Record<string, unknown> | null = null;
    const pipeline = {
      rpc: async (_name: string, args: Record<string, unknown>) => {
        pipelineCalled += 1;
        pipelineArgs = args;
        // replay 없음(blocked) — 그대로 차단 사유로 돌아간다.
        return { data: [{ status: "blocked", deal_id: DEAL, company_id: null, reason: "인계 조건" }], error: null };
      },
    };
    const failed = await capture(requestHandoff(client, pipeline, {
      orgId: ORG,
      itemId: ITEM,
      requestId: REQUEST,
      expectedVersion: 4,
    }));
    expect(failed.code).toBe("handoff_blocked");
    // F6 replay 확인을 위해 파이프라인을 1회 호출한다. F2 정본 deal 을 함께 넘긴다.
    expect(pipelineCalled).toBe(1);
    expect(pipelineArgs).toMatchObject({ p_deal_id: DEAL, p_source_item_id: ITEM });
  });

  it("consultationErrorFromRpc 는 알 수 없는 메시지도 입력과 함께 돌려준다", () => {
    const error = consultationErrorFromRpc(new Error("boom"), { itemId: ITEM });
    expect(error).toBeInstanceOf(ConsultationError);
    expect(error.echo).toMatchObject({ itemId: ITEM });
  });

  it("F2: 인계는 스냅샷 정본 deal/company 를 파이프라인에 그대로 넘긴다", async () => {
    const client = clientWith(() => [snapshotRow()]);
    let seen: Record<string, unknown> | null = null;
    const pipeline = {
      rpc: async (_name: string, args: Record<string, unknown>) => {
        seen = args;
        return {
          data: [{ status: "committed", deal_id: DEAL, company_id: null, reason: null }],
          error: null,
        };
      },
    };
    const result = await requestHandoff(client, pipeline, {
      orgId: ORG,
      itemId: ITEM,
      requestId: REQUEST,
      expectedVersion: 4,
    });
    expect(seen).toMatchObject({ p_deal_id: DEAL, p_source_item_id: ITEM });
    expect(result.dealId).toBe(DEAL);
  });

  it("F2: 파이프라인이 다른 deal 을 돌려주면 stage_contract 로 막는다", async () => {
    const client = clientWith(() => [snapshotRow()]);
    const pipeline = {
      rpc: async () => ({
        data: [{ status: "committed", deal_id: "00000000-0000-4000-8000-00000000ffff", company_id: null, reason: null }],
        error: null,
      }),
    };
    const failed = await capture(requestHandoff(client, pipeline, {
      orgId: ORG,
      itemId: ITEM,
      requestId: REQUEST,
      expectedVersion: 4,
    }));
    expect(failed.code).toBe("stage_contract");
  });

  it("F6: 미달 스냅샷이어도 커밋 replay 는 성공으로 돌려준다(유실 응답)", async () => {
    const client = clientWith(() => [snapshotRow({ ready: false, missing: ["계약금 입금 확인"] })]);
    const pipeline = {
      rpc: async () => ({
        data: [{ status: "committed", deal_id: DEAL, company_id: null, reason: null }],
        error: null,
      }),
    };
    const result = await requestHandoff(client, pipeline, {
      orgId: ORG,
      itemId: ITEM,
      requestId: REQUEST,
      expectedVersion: 4,
    });
    expect(result.dealId).toBe(DEAL);
    expect(result.ready).toBe(true);
  });

  it("F6: 같은 보기 재시도(from==to)는 RPC 에 위임한다(stage_contract 아님)", async () => {
    const client = clientWith(() => [
      { item_id: ITEM, deal_id: DEAL, company_id: null, mode: "inperson", version: 1, replayed: true },
    ]);
    const result = await setConsultationMode(client, {
      orgId: ORG,
      itemId: ITEM,
      from: "inperson",
      to: "inperson",
      meetingAt: "2026-10-01T10:00:00+09:00",
      assigneeId: "user-1",
      requestId: REQUEST,
      expectedVersion: 1,
    });
    expect(result.replayed).toBe(true);
  });
});
