import {
  INPERSON_PHASES,
  REMOTE_PHASES,
  isConsultationPhase,
  phaseNeedsSchedule,
  type ConsultationPhase,
} from "../consultation/phases";

export const NEW_LEAD_CONSULTATION_ENTRY_RPC = "advance_new_lead_to_consultation";

export type NewLeadConsultationEntryMode = "remote" | "inperson";

export type NewLeadConsultationEntryInput = Readonly<{
  itemId: string;
  requestId: string;
  mode: NewLeadConsultationEntryMode;
  phase: ConsultationPhase;
  meetingAt: string | null;
  assignedTo: string | null;
  expectedAssignedTo: string | null;
  expectedAssignmentVersion: number;
}>;

export type NewLeadConsultationEntryResult = Readonly<{
  status: "committed";
  requestId: string;
  itemId: string;
  dealId: string;
  companyId: string | null;
  mode: NewLeadConsultationEntryMode;
  phase: ConsultationPhase;
  meetingAt: string | null;
  assignedTo: string | null;
  consultationVersion: number;
  assignmentVersion: number;
  replayed: boolean;
}>;

export type NewLeadConsultationEntryErrorCode =
  | "invalid_input"
  | "permission_denied"
  | "conflict"
  | "target_mismatch"
  | "unavailable";

export class NewLeadConsultationEntryError extends Error {
  constructor(
    message: string,
    readonly code: NewLeadConsultationEntryErrorCode,
    readonly field: keyof NewLeadConsultationEntryInput | null = null,
    readonly databaseCode: string | null = null,
  ) {
    super(message);
    this.name = "NewLeadConsultationEntryError";
  }
}

export type NewLeadConsultationEntryRpcClient = Readonly<{
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message?: string; code?: string } | null }>;
}>;

type EntryRow = Readonly<{
  status?: unknown;
  request_id?: unknown;
  item_id?: unknown;
  deal_id?: unknown;
  company_id?: unknown;
  mode?: unknown;
  phase?: unknown;
  meeting_at?: unknown;
  assigned_to?: unknown;
  consultation_version?: unknown;
  assignment_version?: unknown;
  replayed?: unknown;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;

function invalid(field: keyof NewLeadConsultationEntryInput, message: string): never {
  throw new NewLeadConsultationEntryError(message, "invalid_input", field);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function sameUuid(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function isTimestamp(value: string): boolean {
  const match = RFC3339.exec(value);
  if (!match) return false;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText);
  const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  return year >= 1
    && month >= 1
    && month <= 12
    && day >= 1
    && day <= (daysInMonth[month - 1] ?? 0)
    && hour <= 23
    && minute <= 59
    && second <= 59
    && offsetHour <= 23
    && offsetMinute <= 59
    && Number.isFinite(Date.parse(value));
}

function validateInput(input: NewLeadConsultationEntryInput): void {
  if (!isUuid(input.itemId)) invalid("itemId", "신규리드 항목 식별자가 올바르지 않습니다.");
  if (!isUuid(input.requestId)) invalid("requestId", "요청 식별자가 올바르지 않습니다.");
  if (input.mode !== "remote" && input.mode !== "inperson") {
    invalid("mode", "상담 방식을 확인해 주세요.");
  }
  if (!isConsultationPhase(input.phase)) invalid("phase", "상담 단계를 확인해 주세요.");

  const allowed = input.mode === "remote" ? REMOTE_PHASES : INPERSON_PHASES;
  if (!allowed.includes(input.phase)) invalid("phase", "상담 방식에 맞는 단계를 선택해 주세요.");

  if (input.meetingAt !== null && !isTimestamp(input.meetingAt)) {
    invalid("meetingAt", "상담 일정을 확인해 주세요.");
  }
  if (phaseNeedsSchedule(input.phase) && input.meetingAt === null) {
    invalid("meetingAt", "이 상담 단계에는 일정이 필요합니다.");
  }
  if (input.meetingAt !== null && input.assignedTo === null) {
    invalid("assignedTo", "일정이 있는 상담에는 담당자가 필요합니다.");
  }
  if (input.assignedTo !== null && !isUuid(input.assignedTo)) {
    invalid("assignedTo", "담당자 식별자가 올바르지 않습니다.");
  }
  if (input.expectedAssignedTo !== null && !isUuid(input.expectedAssignedTo)) {
    invalid("expectedAssignedTo", "현재 담당자 식별자가 올바르지 않습니다.");
  }
  if (!Number.isSafeInteger(input.expectedAssignmentVersion) || input.expectedAssignmentVersion < 0) {
    invalid("expectedAssignmentVersion", "담당자 변경 버전을 확인해 주세요.");
  }
}

function singleRow(value: unknown): EntryRow {
  const row = Array.isArray(value) ? (value.length === 1 ? value[0] : null) : value;
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new NewLeadConsultationEntryError(
      "상담 진입 결과를 확인하지 못했습니다.",
      "unavailable",
    );
  }
  return row as EntryRow;
}

function nullableUuid(value: unknown): string | null | undefined {
  if (value === null) return null;
  return isUuid(value) ? value : undefined;
}

function nullableTimestamp(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" && isTimestamp(value) ? value : undefined;
}

function nonnegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function rpcFailure(error: { message?: string; code?: string }): NewLeadConsultationEntryError {
  if (error.code === "42501") {
    return new NewLeadConsultationEntryError(
      "상담 진입 권한이 없습니다.",
      "permission_denied",
      null,
      error.code,
    );
  }
  if (error.code === "40001") {
    return new NewLeadConsultationEntryError(
      "담당자 또는 상담 상태가 변경되었습니다. 최신 상태를 확인해 주세요.",
      "conflict",
      null,
      error.code,
    );
  }
  if (error.code === "22023" || error.code === "22P02") {
    return new NewLeadConsultationEntryError(
      "상담 진입 대상 또는 요청 정보를 확인해 주세요.",
      "target_mismatch",
      null,
      error.code,
    );
  }
  return new NewLeadConsultationEntryError(
    "상담 진입을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    "unavailable",
    null,
    error.code ?? null,
  );
}

function parseResult(
  value: unknown,
  input: NewLeadConsultationEntryInput,
): NewLeadConsultationEntryResult {
  const row = singleRow(value);
  const companyId = nullableUuid(row.company_id);
  const assignedTo = nullableUuid(row.assigned_to);
  const meetingAt = nullableTimestamp(row.meeting_at);
  const consultationVersion = nonnegativeInteger(row.consultation_version);
  const assignmentVersion = nonnegativeInteger(row.assignment_version);

  const shapeValid = row.status === "committed"
    && isUuid(row.request_id)
    && isUuid(row.item_id)
    && isUuid(row.deal_id)
    && companyId !== undefined
    && (row.mode === "remote" || row.mode === "inperson")
    && isConsultationPhase(row.phase)
    && meetingAt !== undefined
    && assignedTo !== undefined
    && consultationVersion !== null
    && assignmentVersion !== null
    && typeof row.replayed === "boolean";

  if (!shapeValid) {
    throw new NewLeadConsultationEntryError(
      "상담 진입 결과를 확인하지 못했습니다.",
      "unavailable",
    );
  }

  const identityMatches = sameUuid(row.request_id as string, input.requestId)
    && sameUuid(row.item_id as string, input.itemId)
    && row.mode === input.mode
    && row.phase === input.phase
    && (
      (meetingAt === null && input.meetingAt === null)
      || (meetingAt !== null && input.meetingAt !== null && Date.parse(meetingAt) === Date.parse(input.meetingAt))
    )
    && (
      (assignedTo === null && input.assignedTo === null)
      || (assignedTo !== null && input.assignedTo !== null && sameUuid(assignedTo, input.assignedTo))
    );

  if (!identityMatches) {
    throw new NewLeadConsultationEntryError(
      "상담 진입 결과가 요청과 일치하지 않습니다.",
      "target_mismatch",
    );
  }

  return {
    status: "committed",
    requestId: row.request_id as string,
    itemId: row.item_id as string,
    dealId: row.deal_id as string,
    companyId: companyId as string | null,
    mode: row.mode as NewLeadConsultationEntryMode,
    phase: row.phase as ConsultationPhase,
    meetingAt: meetingAt as string | null,
    assignedTo: assignedTo as string | null,
    consultationVersion: consultationVersion as number,
    assignmentVersion: assignmentVersion as number,
    replayed: row.replayed as boolean,
  };
}

export async function advanceNewLeadToConsultation(
  client: NewLeadConsultationEntryRpcClient,
  input: NewLeadConsultationEntryInput,
): Promise<NewLeadConsultationEntryResult> {
  validateInput(input);

  let response: Awaited<ReturnType<NewLeadConsultationEntryRpcClient["rpc"]>>;
  try {
    response = await client.rpc(NEW_LEAD_CONSULTATION_ENTRY_RPC, {
      p_item_id: input.itemId,
      p_request_id: input.requestId,
      p_mode: input.mode,
      p_phase: input.phase,
      p_meeting_at: input.meetingAt,
      p_assigned_to: input.assignedTo,
      p_expected_assigned_to: input.expectedAssignedTo,
      p_expected_assignment_version: input.expectedAssignmentVersion,
    });
  } catch {
    throw new NewLeadConsultationEntryError(
      "상담 진입을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      "unavailable",
    );
  }

  if (response.error) throw rpcFailure(response.error);
  return parseResult(response.data, input);
}
