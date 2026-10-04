import { describe, expect, it, vi } from "vitest";
import {
  NEW_LEAD_CONSULTATION_ENTRY_RPC,
  NewLeadConsultationEntryError,
  advanceNewLeadToConsultation,
  type NewLeadConsultationEntryInput,
} from "./consultation-entry";

const ITEM_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const DEAL_ID = "33333333-3333-4333-8333-333333333333";
const COMPANY_ID = "44444444-4444-4444-8444-444444444444";
const ASSIGNEE_ID = "55555555-5555-4555-8555-555555555555";
const PREVIOUS_ASSIGNEE_ID = "66666666-6666-4666-8666-666666666666";
const MEETING_AT = "2026-10-10T01:00:00.000Z";

const input: NewLeadConsultationEntryInput = {
  itemId: ITEM_ID,
  requestId: REQUEST_ID,
  mode: "remote",
  phase: "scheduled",
  meetingAt: MEETING_AT,
  assignedTo: ASSIGNEE_ID,
  expectedAssignedTo: PREVIOUS_ASSIGNEE_ID,
  expectedAssignmentVersion: 4,
};

function committed(overrides: Record<string, unknown> = {}) {
  return {
    status: "committed",
    request_id: REQUEST_ID,
    item_id: ITEM_ID,
    deal_id: DEAL_ID,
    company_id: COMPANY_ID,
    mode: "remote",
    phase: "scheduled",
    meeting_at: MEETING_AT,
    assigned_to: ASSIGNEE_ID,
    consultation_version: 7,
    assignment_version: 5,
    replayed: false,
    ...overrides,
  };
}

describe("advanceNewLeadToConsultation", () => {
  it("calls exactly one future RPC without caller-provided tenant or deal identity", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [committed()], error: null });

    await expect(advanceNewLeadToConsultation({ rpc }, input)).resolves.toEqual({
      status: "committed",
      requestId: REQUEST_ID,
      itemId: ITEM_ID,
      dealId: DEAL_ID,
      companyId: COMPANY_ID,
      mode: "remote",
      phase: "scheduled",
      meetingAt: MEETING_AT,
      assignedTo: ASSIGNEE_ID,
      consultationVersion: 7,
      assignmentVersion: 5,
      replayed: false,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(NEW_LEAD_CONSULTATION_ENTRY_RPC, {
      p_item_id: ITEM_ID,
      p_request_id: REQUEST_ID,
      p_mode: "remote",
      p_phase: "scheduled",
      p_meeting_at: MEETING_AT,
      p_assigned_to: ASSIGNEE_ID,
      p_expected_assigned_to: PREVIOUS_ASSIGNEE_ID,
      p_expected_assignment_version: 4,
    });
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_org_id");
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_deal_id");
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_company_id");
  });

  it("accepts a replayed in-person result and preserves the request identity", async () => {
    const inperson = {
      ...input,
      mode: "inperson" as const,
      phase: "meeting_scheduled" as const,
      expectedAssignedTo: null,
      expectedAssignmentVersion: 0,
    };
    const rpc = vi.fn().mockResolvedValue({
      data: committed({
        company_id: null,
        mode: "inperson",
        phase: "meeting_scheduled",
        assignment_version: 1,
        replayed: true,
      }),
      error: null,
    });

    await expect(advanceNewLeadToConsultation({ rpc }, inperson)).resolves.toEqual(
      expect.objectContaining({
        requestId: REQUEST_ID,
        itemId: ITEM_ID,
        companyId: null,
        mode: "inperson",
        phase: "meeting_scheduled",
        assignmentVersion: 1,
        replayed: true,
      }),
    );
  });

  it.each([
    ["itemId", { itemId: "item-1" }],
    ["requestId", { requestId: "request-1" }],
    ["mode", { mode: "phone" }],
    ["phase", { phase: "meeting_done" }],
    ["meetingAt", { meetingAt: "tomorrow" }],
    ["meetingAt", { meetingAt: "2026-02-30T01:00:00Z" }],
    ["meetingAt", { meetingAt: "2026-02-29T01:00:00Z" }],
    ["meetingAt", { meetingAt: null }],
    ["assignedTo", { assignedTo: null }],
    ["assignedTo", { assignedTo: "user-1" }],
    ["expectedAssignedTo", { expectedAssignedTo: "user-2" }],
    ["expectedAssignmentVersion", { expectedAssignmentVersion: -1 }],
    ["expectedAssignmentVersion", { expectedAssignmentVersion: 1.5 }],
  ])("rejects invalid %s input before the RPC", async (field, patch) => {
    const rpc = vi.fn();
    const promise = advanceNewLeadToConsultation({ rpc }, { ...input, ...patch } as never);

    await expect(promise).rejects.toEqual(expect.objectContaining({
      name: "NewLeadConsultationEntryError",
      code: "invalid_input",
      field,
    }));
    expect(rpc).not.toHaveBeenCalled();
  });

  it("allows a no-schedule phase with a nullable assignee", async () => {
    const noSchedule = {
      ...input,
      phase: "information" as const,
      meetingAt: null,
      assignedTo: null,
      expectedAssignedTo: null,
      expectedAssignmentVersion: 0,
    };
    const rpc = vi.fn().mockResolvedValue({
      data: committed({
        phase: "information",
        meeting_at: null,
        assigned_to: null,
        assignment_version: 0,
      }),
      error: null,
    });

    await expect(advanceNewLeadToConsultation({ rpc }, noSchedule)).resolves.toEqual(
      expect.objectContaining({ phase: "information", meetingAt: null, assignedTo: null }),
    );
  });

  it.each([
    ["42501", "permission_denied"],
    ["40001", "conflict"],
    ["22023", "target_mismatch"],
    ["22P02", "target_mismatch"],
    ["XX000", "unavailable"],
  ])("maps database error %s to %s", async (databaseCode, code) => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: databaseCode } });

    await expect(advanceNewLeadToConsultation({ rpc }, input)).rejects.toEqual(
      expect.objectContaining({
        name: "NewLeadConsultationEntryError",
        code,
        databaseCode,
      }),
    );
  });

  it("fails closed on a thrown transport error", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("network detail"));

    await expect(advanceNewLeadToConsultation({ rpc }, input)).rejects.toEqual(
      expect.objectContaining({ code: "unavailable", databaseCode: null }),
    );
  });

  it.each([
    ["empty result", []],
    ["multiple rows", [committed(), committed()]],
    ["wrong status", committed({ status: "blocked" })],
    ["missing deal identity", committed({ deal_id: null })],
    ["invalid version", committed({ assignment_version: -1 })],
    ["invalid replay marker", committed({ replayed: "true" })],
    ["impossible meeting date", committed({ meeting_at: "2026-02-30T01:00:00Z" })],
  ])("fails closed on %s", async (_label, data) => {
    const rpc = vi.fn().mockResolvedValue({ data, error: null });

    await expect(advanceNewLeadToConsultation({ rpc }, input)).rejects.toEqual(
      expect.objectContaining({ code: "unavailable" }),
    );
  });

  it.each([
    ["request identity", { request_id: "77777777-7777-4777-8777-777777777777" }],
    ["item identity", { item_id: "77777777-7777-4777-8777-777777777777" }],
    ["mode", { mode: "inperson" }],
    ["phase", { phase: "information" }],
    ["meeting", { meeting_at: "2026-10-11T01:00:00.000Z" }],
    ["assignee", { assigned_to: "77777777-7777-4777-8777-777777777777" }],
  ])("rejects a mismatched %s result", async (_label, patch) => {
    const rpc = vi.fn().mockResolvedValue({ data: committed(patch), error: null });

    await expect(advanceNewLeadToConsultation({ rpc }, input)).rejects.toEqual(
      expect.objectContaining({ code: "target_mismatch" }),
    );
  });

  it("returns a typed error rather than leaking malformed results", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });

    await expect(advanceNewLeadToConsultation({ rpc }, input)).rejects.toBeInstanceOf(
      NewLeadConsultationEntryError,
    );
  });
});
