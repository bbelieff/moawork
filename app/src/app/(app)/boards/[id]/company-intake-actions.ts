"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import {
  createCompanyAndStartWork,
  CompanyIntakeError,
  startCompanyWork,
  type CompanyStartWorkClient,
} from "@/lib/companies/start-work";
import {
  foundedMonthToFoundedOn,
  joinCanonicalRegion,
  normalizeCompanyNameForDuplicateCheck,
} from "@/lib/companies/intake-mapping";
import { createClient } from "@/lib/supabase/server";
import { getCrmService } from "@/lib/crm";
import { parseCreateCompany, ValidationError } from "@/lib/crm/validation";
import {
  NEW_LEAD_BUSINESS_TYPES,
  resolveNewLeadBusinessSubtype,
} from "@/lib/new-lead/business-types";
import type { Company } from "@/lib/types";

/**
 * 계약업체 실무의 「＋ 업체 추가」 — 고른 회사로 자금 건을 하나 시작한다.
 *
 * ★ 새 RPC 를 만들지 않았다. `start_company_work` 가 이미 그 일을 한다
 *   (회사 상세의 「업무 시작」이 쓰던 것). 같은 일에 두 개의 문을 내면
 *   한쪽만 고쳐질 때 두 화면이 다르게 동작한다.
 *
 * ★ 같은 회사를 «여러 번» 시작할 수 있다.
 *   RPC 의 멱등 열쇠는 `request_id` 지 `company_id` 가 아니다 —
 *   즉 «같은 버튼을 두 번 눌렀을 때» 만 막고, «이 회사로 또 한 건» 은 막지 않는다.
 *   목업이 요구하는 「한 회사에 매출이 여러 번 일어난다」 가 그대로 성립한다.
 */
function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export type NewCompanyCandidate = Readonly<{
  id: string;
  name: string;
  /** 대표자·사업자유형·지역·전화 중 있는 것만 이어 붙인 한 줄. */
  detail: string;
}>;

export type CompanyIntakeActionState = Readonly<{
  ok: boolean | null;
  outcome?: "rejected" | "uncertain";
  message: string;
  /**
   * 155 원자 경로에서는 실패가 전체를 되돌리므로 붙지 않는다.
   * 예비책이 없어 «등록은 됐는데 시작만 실패» 상태가 생기지 않는다.
   * 과거 상태와의 형 호환용으로만 남긴다.
   */
  retryCompanyId?: string | null;
  /**
   * 재시도가 같은 멱등 열쇠를 쓰도록 돌려준다. 첫 시도가 서버에서 이미 됐는데
   * 응답만 잃었어도 RPC 가 replay 로 묶는다.
   */
  retryRequestId?: string | null;
  /**
   * 같은 이름 후보가 이미 있을 때 — 자동 병합 없이 고르게 보여준다.
   * 이게 있으면 회사를 만들지 않았다.
   */
  conflictCandidates?: readonly NewCompanyCandidate[];
  /** 방금 만든 회사 id (성공·재시도 분기 확인용). */
  createdCompanyId?: string | null;
}>;

export async function startCompanyWorkFromBoardAction(
  _previous: CompanyIntakeActionState,
  formData: FormData,
): Promise<CompanyIntakeActionState> {
  const companyId = text(formData, "companyId");
  const requestId = text(formData, "requestId");
  const boardId = text(formData, "boardId");
  if (!companyId || !requestId || !boardId) {
    return { ok: false, outcome: "rejected", message: "업체를 선택한 뒤 다시 시도해 주세요." };
  }

  try {
    const ctx = await getSession();
    const client = await createClient();
    // groupId 는 «누른 그룹» 이다. 없으면(그룹 없음 블록) 서버가 첫 그룹을 고른다.
    // 서버가 그 그룹이 이 조직·이 보드의 것인지 다시 확인한다 — 화면 값을 믿지 않는다.
    await startCompanyWork(client as unknown as CompanyStartWorkClient, {
      orgId: ctx.org.id,
      companyId,
      requestId,
      groupId: text(formData, "groupId") || null,
    });
  } catch (error) {
    // DB 원문은 화면에 노출하지 않고 서버 로그에만 남긴다.
    console.error("[company intake] failed to start work", error);
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    const rejected = typeof code === "string" && ["42501", "22023", "23503", "23505", "PGRST202", "42883"].includes(code);
    return rejected
      ? { ok: false, outcome: "rejected", message: "업무를 시작하지 못했어요. 업체와 권한을 확인한 뒤 다시 시도해 주세요." }
      : { ok: false, outcome: "uncertain", message: "저장 결과를 확인하지 못했어요. 같은 회사로 다시 시도해 결과를 확인해 주세요." };
  }

  // 이 건은 세 화면에 동시에 나타난다 — 보드 · 계약업체 실무 진입 · 업체관리 현황.
  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/work");
  revalidatePath("/companies");
  revalidatePath(`/companies/${companyId}`);
  return { ok: true, message: "업무를 시작했어요." };
}

function candidateDetail(company: Company): string {
  return [company.owner_name, company.biz_type, company.region, company.phone]
    .filter(Boolean)
    .join(" · ");
}

type NewCompanyInput = Readonly<{
  name: string;
  biz_type: string | null;
  founded_on: string | null;
  region: string | null;
  phone: string | null;
  owner_name: string | null;
}>;

/**
 * 새 회사 입력의 정본 매핑 — 화면 이름과 저장 이름이 다르다.
 * 사업자유형은 신규리드 정본 3종+하위구분, 창업은 승인된 창업연월(`YYYY-MM`),
 * 지역은 시도+시군구 정본 검색의 단일 카탈로그 값. 셋 다 새로 지어내지 않는다.
 * DOB 같은 OCR 소유 항목은 여기서 받지 않는다(154 예약).
 */
function mapNewCompanyInput(formData: FormData): NewCompanyInput {
  const name = text(formData, "companyName");
  if (!name) throw new ValidationError("회사 이름을 입력해 주세요.");

  const selected = text(formData, "businessType");
  let bizType: string | null = null;
  if (selected !== "") {
    if (!(NEW_LEAD_BUSINESS_TYPES as readonly string[]).includes(selected)) {
      throw new ValidationError("사업자유형을 목록에서 선택해 주세요.");
    }
    bizType = resolveNewLeadBusinessSubtype(
      selected,
      text(formData, "businessSubtype"),
      text(formData, "businessCustom"),
    );
    if (!bizType) throw new ValidationError("사업자유형을 목록에서 선택해 주세요.");
  }

  let foundedOn: string | null;
  try {
    foundedOn = foundedMonthToFoundedOn(text(formData, "foundedMonth"));
  } catch {
    throw new ValidationError("창업연월은 YYYY-MM 형식으로 입력해 주세요.");
  }

  let region: string | null;
  try {
    region = joinCanonicalRegion(text(formData, "regionSido"), text(formData, "regionSigungu"));
  } catch (error) {
    throw new ValidationError(error instanceof Error ? error.message : "지역을 추천 목록에서 선택해 주세요.");
  }

  // ★ 정본 검증 재사용 — `/api/companies` POST 와 같은 `parseCreateCompany` 다.
  const parsed = parseCreateCompany({
    name,
    biz_type: bizType,
    founded_on: foundedOn,
    region,
    phone: text(formData, "phone") || null,
    owner_name: text(formData, "ownerName") || null,
  });
  return {
    name: parsed.name,
    biz_type: parsed.biz_type ?? null,
    founded_on: parsed.founded_on ?? null,
    region: parsed.region ?? null,
    phone: parsed.phone ?? null,
    owner_name: parsed.owner_name ?? null,
  };
}

function isMissingIntakeFunction(error: CompanyIntakeError): boolean {
  return error.code === "PGRST202" || error.code === "42883"
    || /Could not find the function|does not exist/i.test(error.message ?? "");
}

function isDuplicateCandidate(error: CompanyIntakeError): boolean {
  return /duplicate candidate/.test(error.message ?? "");
}

function intakeRpcMessage(error: CompanyIntakeError): string {
  if (error.code === "42501") return "이 업체로 업무를 시작할 권한이 없어요.";
  const message = error.message ?? "";
  if (/idempotency key reuse/.test(message)) {
    return "같은 요청으로 다른 내용을 보내고 있어요. 화면을 새로고침한 뒤 다시 시도해 주세요.";
  }
  if (/duplicate candidate/.test(message)) {
    return "같은 이름의 회사가 이미 있어요. 아래에서 골라 진행하거나, 다른 이름인지 확인해 주세요.";
  }
  if (/target unavailable|pipeline unavailable/.test(message)) {
    return "업무를 넣을 보드·그룹을 찾지 못했어요. 화면을 새로고침한 뒤 다시 시도해 주세요.";
  }
  if (/founded invalid|input required/.test(message)) {
    return "입력을 확인한 뒤 다시 시도해 주세요.";
  }
  return "저장 결과를 확인하지 못했어요. 같은 내용으로 다시 시도해 결과를 확인해 주세요.";
}

/**
 * 2026-09-27 엣지 — 계약업체 실무 «＋ 업체 추가» 안의 «새 회사» 등록 + 업무 시작.
 *
 * ★ 정본은 155 `create_company_and_start_work` 뿐이다. 목표(보드·그룹) 실재와
 *   권한을 어떤 INSERT보다 먼저 보고, 입력 검증 뒤 요청 원장 잠금·replay를 본다.
 *   replay는 후보 차단보다 먼저다 — 잃어버린 응답의 같은 열쇠+같은 내용은
 *   자신이 막 만든 회사여도 같은 회사·딜로 돌려준다. genuinely new 열쇠만
 *   RPC 트랜잭션 안에서 보이는 범위의 같은 이름을 본다 (race 없음).
 *   목표가 가짜거나 권한이 없으면 회사를 만들지 않는다. 실패는 전체를 되돌린다.
 *   155가 없으면 fail-closed로 끝내고 쓰지 않는다 — 155 배포가 앱보다 먼저다.
 *
 * ★ 기존 회사 경로(`startCompanyWorkFromBoardAction` → 141 `start_company_work_v2`)는 그대로다.
 *   같은 회사의 여러 건·멱등 request 의미가 두 경로에서 갈라지지 않는다.
 *   155는 같은 열쇠를 옛 원장에도 묶어 옛 replay와 일치한다.
 *
 * ★ 신규리드 행을 만들지 않는다 — 회사 등록에 리드컨택 경유는 정본 계약상 필요 없다.
 *
 * ★ 중복은 «보이는 범위에서 후보만» 보여준다. 자동 병합은 없다.
 *   RPC는 막기만 하고 고객 데이터를 돌려주지 않는다 — 목록은 앱이 보이는
 *   범위에서 따로 읽어 최대 5개·최소 필드(id·이름·한 줄)만 보여준다.
 *   안 보이는 회사는 막지 않는다 (RLS 기존 동작: 만들 수 있다).
 *
 * ★ 예전 두 단계 예비책(`createCompany → startCompanyWork`)은 없다.
 *   시작만 실패해 회사가 남는 상태를 만들지 않는다 — missing 155는 ZERO writes다.
 *
 * ★ 테넌트·권한은 서버 세션에서만 읽는다(`ctx.org.id`). 호출자가 보낸 org 값은 믿지 않는다.
 *   입력·요청 식별(workRequestId·boardId·groupId)은 그대로 둔다.
 */
export async function startCompanyWorkFromNewCompanyAction(
  _previous: CompanyIntakeActionState,
  formData: FormData,
): Promise<CompanyIntakeActionState> {
  const workRequestId = text(formData, "workRequestId");
  const boardId = text(formData, "boardId");
  const groupId = text(formData, "groupId") || null;
  if (!workRequestId || !boardId) {
    return { ok: false, outcome: "rejected", message: "회사 이름을 입력한 뒤 다시 시도해 주세요." };
  }

  let companyInput: NewCompanyInput;
  try {
    companyInput = mapNewCompanyInput(formData);
  } catch (error) {
    if (error instanceof ValidationError) {
      return { ok: false, outcome: "rejected", message: `입력을 확인해 주세요. ${error.message}` };
    }
    console.error("[company intake] new company validation failed", error);
    return { ok: false, outcome: "rejected", message: "입력을 확인한 뒤 다시 시도해 주세요." };
  }

  let ctx: Awaited<ReturnType<typeof getSession>>;
  try {
    // ★ 세션 조직이 정본이다 — 폼이 보낸 org 값이 있어도 읽지 않는다.
    ctx = await getSession();
  } catch (error) {
    console.error("[company intake] new company session failed", error);
    return { ok: false, outcome: "rejected", message: "로그인을 확인한 뒤 다시 시도해 주세요." };
  }

  // 정본 — 155 원자 intake뿐이다. 입력 검증·세션을 먼저 보고 RPC를 잇는다.
  // RPC 안의 순서는 권한·목표 → replay → 후보 → 쓰기다. 앱은 후보를 먼저 막지
  // 않는다 — 잃어버린 응답의 같은 열쇠+같은 내용이 자신의 회사에 막히지 않게.
  // genuinely new 열쇠의 중복은 RPC가 트랜잭션 안에서 막고, 앱은 보이는 범위의
  // 후보만 읽어 보여준다 (자동 병합 없음·유출 없음). 155 없이는 쓰지 않는다.
  try {
    const client = await createClient();
    const result = await createCompanyAndStartWork(
      client as unknown as CompanyStartWorkClient,
      {
        orgId: ctx.org.id,
        boardId,
        groupId,
        requestId: workRequestId,
        name: companyInput.name,
        bizType: companyInput.biz_type,
        foundedOn: companyInput.founded_on,
        region: companyInput.region,
        phone: companyInput.phone,
        ownerName: companyInput.owner_name,
      },
    );
    revalidatePath(`/boards/${boardId}`);
    revalidatePath("/work");
    revalidatePath("/companies");
    revalidatePath(`/companies/${result.companyId}`);
    return {
      ok: true,
      message: result.replayed
        ? "이미 등록된 요청이에요. 같은 회사로 진행합니다."
        : "새 회사를 등록하고 업무를 시작했어요.",
      createdCompanyId: result.companyId,
    };
  } catch (error) {
    if (error instanceof CompanyIntakeError) {
      if (isMissingIntakeFunction(error)) {
        console.error("[company intake] rpc missing — fail closed, zero writes", {
          boardId, groupId, requestId: workRequestId, error,
        });
        return { ok: false, outcome: "rejected", message: "회사 등록 기능을 지금 사용할 수 없어요. 관리자에게 문의해 주세요." };
      }
      if (isDuplicateCandidate(error)) {
        // RPC는 막기만 했다 (쓰기 없음·유출 없음) — 보이는 후보만 읽어 보여준다.
        try {
          const crm = getCrmService();
          const existing = await crm.listCompanies(ctx);
          const wanted = normalizeCompanyNameForDuplicateCheck(companyInput.name);
          const candidates = existing.filter(
            (company) => normalizeCompanyNameForDuplicateCheck(company.name) === wanted,
          );
          if (candidates.length > 0) {
            return {
              ok: false,
              outcome: "rejected",
              message: "같은 이름의 회사가 이미 있어요. 아래에서 골라 진행하거나, 다른 이름인지 확인해 주세요.",
              conflictCandidates: candidates.slice(0, 5).map((company) => ({
                id: company.id,
                name: company.name,
                detail: candidateDetail(company),
              })),
            };
          }
        } catch (lookupError) {
          console.error("[company intake] candidate lookup failed", {
            boardId, groupId, requestId: workRequestId, error: lookupError,
          });
        }
        console.error("[company intake] atomic intake duplicate", {
          boardId, groupId, requestId: workRequestId, error,
        });
        return { ok: false, outcome: "rejected", message: intakeRpcMessage(error) };
      }
      console.error("[company intake] atomic intake denied", {
        boardId, groupId, requestId: workRequestId, error,
      });
      return { ok: false, outcome: ["42501", "22023", "23503", "23505"].includes(error.code ?? "") ? "rejected" : "uncertain", message: intakeRpcMessage(error) };
    }
    console.error("[company intake] atomic intake failed", {
      boardId, groupId, requestId: workRequestId, error,
    });
    return { ok: false, outcome: "uncertain", message: "저장 결과를 확인하지 못했어요. 같은 내용으로 다시 시도해 결과를 확인해 주세요." };
  }
}
