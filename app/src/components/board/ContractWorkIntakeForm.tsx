"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { rankCompanies, type CompanyPickerRow } from "@/lib/companies/search";
import {
  workspaceBaseFromPathname,
  workspaceHref,
} from "@/components/shell/workspace-href";
import type {
  CompanyIntakeActionState,
  NewCompanyCandidate,
} from "@/app/(app)/boards/[id]/company-intake-actions";
// ★ 정본 재사용 — 사업자유형은 신규리드 3종+하위구분(business-types),
//   지역은 시도+시군구 정본 검색(region-search + RegionCombobox).
//   창업은 승인된 창업연월(month)이다. 여기서 새로 적으면 정본과 어긋난다.
//   DOB 같은 OCR 소유 항목은 받지 않는다(154 예약).
import {
  NEW_LEAD_BUSINESS_TYPES,
  NEW_LEAD_CORPORATE_BUSINESS_SUBTYPES,
  NEW_LEAD_CUSTOM_BUSINESS_TYPE,
  NEW_LEAD_PERSONAL_BUSINESS_SUBTYPES,
} from "@/lib/new-lead/business-types";
import {
  canonicalSido,
  searchSido,
  searchSigungu,
} from "@/lib/new-lead/region-search";
import { RegionCombobox } from "./NewLeadIntakeFields";

const INITIAL_ACTION_STATE: CompanyIntakeActionState = { ok: null, message: "" };

/** 새 회사 등록 동작이 연결되지 않았을 때 — 폼을 깨지 않고 이유만 말한다. */
async function missingNewCompanyAction(): Promise<CompanyIntakeActionState> {
  return { ok: false, message: "새 회사 등록 동작이 연결되지 않았어요. 화면을 새로고침해 주세요." };
}



/**
 * uuid 를 만든다 — 보안 컨텍스트가 아닌 곳에서도.
 *
 * `crypto.randomUUID` 는 secure context 에만 있다. `http://192.168.x.x:3000` 으로 여는
 * 375px 모바일 확인(AGENTS.md §3)에서는 `undefined` 라, 예외가 react-dom 의
 * 디스패치 try/catch 에 삼켜지고 빈 열쇠가 전송된다. 그러면 화면에는
 * 「업체를 선택한 뒤 다시 시도해 주세요」가 떠서 «사용자 탓» 처럼 보인다.
 * 전에는 서버가 발급해서 이 경로가 멀쩡했으므로, 그냥 두면 그것도 회귀다.
 *
 * ★ 서버 발급으로 되돌리지 않는다 — 그게 이 PR 이 고친 결함이다.
 */
function newRequestId(): string {
  const api = globalThis.crypto;
  if (typeof api?.randomUUID === "function") return api.randomUUID();
  const bytes = new Uint8Array(16);
  api.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * 계약업체 실무의 「＋ 업체 추가」 — 목업 `openPicker` 를 옮긴 것이다.
 *
 * 왜 이름 입력칸이 아닌가
 *   이 보드의 한 줄은 «자금 건» 이고, 자금 건은 언제나 «어느 회사의» 것이다.
 *   이름만 받으면 같은 회사가 이름 표기만 달리해서 여러 번 들어온다 —
 *   그러면 업체관리 현황에서 한 회사가 여러 줄로 쪼개진다.
 *   목업이 그걸 한 줄로 못박아 뒀다:
 *     「이미 있는 업체를 고르면 저장된 정보가 그대로 채워집니다 — 같은 회사를 두 번 적지 않게」
 *
 * ★ 같은 회사를 «여러 번» 진행하는 것이 정상이다
 *   회사 하나에 자금 건이 3건일 수 있다(목업 note: 「한 회사에 매출이 여러 번 일어난다」).
 *   그래서 이미 이력이 있는 회사도 고를 수 있어야 하고, 오히려 위로 올려 준다.
 */
export function ContractWorkIntakeForm({
  rows,
  loadError,
  truncated,
  startWorkAction,
  startNewCompanyWorkAction,
  boardId,
  groupId,
  inputClassName,
}: {
  rows: readonly CompanyPickerRow[];
  loadError?: string | null;
  /**
   * 목록이 상한에 걸려 «전부가 아닐» 때 true.
   *
   * ★ 이 화면에서 제일 위험한 문장이 아래의 「찾는 업체가 없다면 … 먼저 등록해 주세요」다.
   *   목록이 잘렸는데 그 문장을 그대로 보이면, 이미 있는 회사를 «없다» 고 읽고 새로 만든다 —
   *   이 화면이 애초에 막으려던 중복을 이 화면이 만들게 된다.
   *   그래서 잘렸을 때는 순서를 바꾼다 — 「먼저 찾아보고, 거기에도 없으면 등록」.
   *   ★ «교체» 가 아니라 «덧붙이기» 다. 교체하면 회사가 많은 조직은 진짜로 없는 회사를
   *     만나도 등록 안내를 영영 못 봐서 막다른 길이 된다.
   */
  truncated: boolean;
  startWorkAction: (
    previous: CompanyIntakeActionState,
    formData: FormData,
  ) => Promise<CompanyIntakeActionState>;
  /**
   * 2026-09-26 — «새 회사» 등록 + 업무 시작 서버 액션. page → BoardWorkspace → GroupTable 으로
   *   내려오며, 없으면 새 회사 패널의 제출만 막힌다(기존 회사 경로는 그대로).
   */
  startNewCompanyWorkAction?: (
    previous: CompanyIntakeActionState,
    formData: FormData,
  ) => Promise<CompanyIntakeActionState>;
  boardId: string;
  /**
   * 누른 그룹. 이 값이 없으면 서버가 «맨 위» 그룹에 넣는다(#588).
   * 「그룹 없음」 블록에서는 null 이고, 그때는 종전과 같이 서버가 첫 그룹을 고른다.
   */
  groupId: string | null;
  inputClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const newRequest = useRef<{ id: string; payload: string; confirmed: boolean; uncertain: boolean } | null>(null);
  const existingRequest = useRef<{ id: string; payload: string } | null>(null);
  const existingInFlight = useRef(false);
  const [requestNotice, setRequestNotice] = useState("");
  const [state, action, pending] = useActionState(async (previous: CompanyIntakeActionState, form: FormData) => {
    try {
      const result = await startWorkAction(previous, form);
      if (result.ok || result.outcome === "rejected") existingRequest.current = null;
      return result;
    } catch {
      return { ok: false, outcome: "uncertain" as const, message: "저장 결과를 확인하지 못했어요. 같은 회사로 다시 시도해 결과를 확인해 주세요." };
    } finally {
      existingInFlight.current = false;
    }
  }, INITIAL_ACTION_STATE);

  function stampExistingRequest(event: React.FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    const field = form.elements.namedItem("requestId");
    if (!(field instanceof HTMLInputElement)) return;
    const payload = JSON.stringify([...new FormData(form)].filter(([key]) => key !== "requestId"));
    if (newRequest.current?.uncertain) {
      event.preventDefault();
      setRequestNotice("새 회사의 저장 결과를 먼저 확인해 주세요. 새 회사 탭에서 같은 내용으로 다시 시도해 주세요.");
      return;
    }
    if (existingInFlight.current) { event.preventDefault(); return; }
    if (existingRequest.current && existingRequest.current.payload !== payload) {
      event.preventDefault();
      setRequestNotice("이전 회사의 저장 결과를 먼저 확인해 주세요. 같은 회사로 다시 시도하면 중복 없이 확인합니다.");
      return;
    }
    existingRequest.current ??= { id: newRequestId(), payload };
    field.value = existingRequest.current.id;
    existingInFlight.current = true;
    setRequestNotice("");
  }
  // 2026-09-26 — «기존 회사» / «새 회사» 를 같은 compact 흐름 안에 둔다.
  //   전에는 새 회사가 회사관리 페이지(CSV 전용)로 빠져서 이 화면의 중복 방지(먼저 찾기)가 무너졌다.
  const [mode, setMode] = useState<"existing" | "new">("existing");
  // React action reset and tab unmount must not discard a possibly committed request.
  const [newCompanyState, newCompanyDispatch, newCompanyPending] = useActionState(
    async (previous: CompanyIntakeActionState, formData: FormData) => {
      try {
        const result = await (startNewCompanyWorkAction ?? missingNewCompanyAction)(previous, formData);
        if (newRequest.current) newRequest.current.uncertain = !result.ok && result.outcome !== "rejected" && !result.conflictCandidates?.length;
        if (result.ok && newRequest.current?.id === formData.get("workRequestId")) {
          newRequest.current.confirmed = true;
          newRequest.current.payload = JSON.stringify([...formData].filter(([key]) => key !== "workRequestId"));
        }
        return result;
      } catch {
        return { ok: false, message: "저장 결과를 확인하지 못했어요. 입력을 유지했어요. 같은 내용으로 다시 시도해 결과를 확인해 주세요." };
      }
    },
    INITIAL_ACTION_STATE,
  );
  // ★ controlled — 실패해도 입력값이 남는다.
  //   React 19 가 액션 뒤 폼을 리셋해도 state 는 그대로라 «다시 시작» 이 같은 값으로 간다.
  //   RegionFields/BusinessTypeField를 직접 쓰지 않고 같은 정본 부품으로 lifted state를 두는
  //   이유다 — 그 필드들은 폼 reset을 받으면 스스로 비우는데, 이 화면은 실패 뒤 값을 남겨야 한다.
  const [companyName, setCompanyName] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [businessSubtype, setBusinessSubtype] = useState("일반");
  const [businessCustom, setBusinessCustom] = useState("");
  const [foundedMonth, setFoundedMonth] = useState("");
  const [regionSido, setRegionSido] = useState("");
  const [regionSigungu, setRegionSigungu] = useState("");
  const [phone, setPhone] = useState("");
  // 「업체관리 현황」으로 보내는 링크는 «지금 회사의» 것이어야 한다 —
  // 네임스페이스를 잃으면 남의 워크스페이스로 보내는 대신 진입 화면으로 튕긴다.
  const companiesHref = workspaceHref(
    workspaceBaseFromPathname(usePathname()) ?? undefined,
    "/companies",
  );

  const shown = useMemo(() => rankCompanies(rows, query), [rows, query]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 text-xs text-mw-sub hover:text-mw-fg"
      >
        <span aria-hidden="true">＋</span> 업체 추가
      </button>
    );
  }

  return (
    <div className="flex w-full max-w-2xl flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">
          업체 추가 <span className="font-normal text-mw-sub">— 회사명을 먼저 찾습니다</span>
        </h3>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-mw-sub hover:text-mw-fg">
          닫기
        </button>
      </div>

      {/*
        2026-09-26 — «기존 회사» / «새 회사» 를 같은 흐름 안에 둔다.
        전에는 새 회사가 회사관리 페이지(CSV 전용)로 빠져서, 이 화면이 막으려던 중복을
        이 화면이 만들었다(목록에 있는 줄 모르고 새로 등록). 기본은 «기존 회사» 다 —
        먼저 찾아보고, 정말 없으면 옆 탭에서 등록한다.
      */}
      <div className="flex gap-1" role="tablist" aria-label="업체 추가 방식">
        {(["existing", "new"] as const).map((candidate) => (
          <button
            key={candidate}
            type="button"
            role="tab"
            aria-selected={mode === candidate}
            onClick={() => setMode(candidate)}
            className={`rounded px-2 py-1 text-xs ${mode === candidate ? "bg-mw-tint-blue font-semibold text-mw-primary" : "text-mw-sub hover:text-mw-fg"}`}
          >
            {candidate === "existing" ? "기존 회사" : "새 회사"}
          </button>
        ))}
      </div>

      {requestNotice ? <p role="alert" className="text-xs text-[var(--mw-error)]">{requestNotice}</p> : null}
      {mode === "new" && state.message ? (
        <p role={state.ok ? "status" : "alert"} className="text-xs">{state.message}</p>
      ) : null}
      {mode === "existing" ? (
      <>
      <input
        autoFocus
        disabled={Boolean(loadError) || pending}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        // 목업의 안내를 그대로 옮기되, 총괄 지시로 «회사에 붙은 것 전부» 를 찾는다고 적는다.
        placeholder="회사명 · 대표자 · 연락처로 찾을 수 있어요 (초성도 됩니다)"
        aria-label="업체 검색"
        className={inputClassName}
      />

      <ul className="max-h-72 overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-800" aria-busy={pending}>
        {loadError ? (
          <li role="alert" className="px-3 py-6 text-center text-sm text-[var(--mw-error)]">
            {loadError}
          </li>
        ) : shown.map(({ company, dealCount }) => (
          <li key={company.id} className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-900">
            {/*
              ★ 멱등 열쇠는 «고를 때마다» 새로 만든다 — 화면을 그릴 때 한 번이 아니다.
                전에는 서버가 렌더당 하나를 발급해(page.tsx 의 crypto.randomUUID())
                모든 행·모든 그룹의 폼이 같은 값을 달고 있었다.
                RPC 의 멱등 열쇠는 (org_id, request_id) 이고, 같은 열쇠를 «다른 회사» 로
                다시 쓰면 22023 으로 거절한다 —
                  supabase/migrations/117_bbe237_company_start_work.sql:92
                  if v_prior.company_id <> p_company_id then raise ... 'idempotency key reuse'
                즉 회사A 를 고른 직후 회사B 를 고르면 두 번째가 «항상» 거절됐다.
                「동일 회사 반복 허용, 동일 request 중복만 차단」이라는 이 기능의
                수용조건을 정확히 뒤집는 형태였다.
                submit 시점에 «비어 있을 때만» 만들면 선택 하나가 열쇠 하나를 갖고,
                진행 중인 한 건의 더블클릭은 같은 열쇠라 RPC 가 하나로 묶는다.
                (disabled={pending} 은 이 보호에 못 쓴다 — stampRequestId 주석 참조.)
            */}
            <form action={action} onSubmit={stampExistingRequest}>
              <input type="hidden" name="companyId" value={company.id} />
              {/* 값은 비워 두고 제출 직전에 채운다 — stampRequestId 참조 */}
              <input type="hidden" name="requestId" defaultValue="" />
              <input type="hidden" name="boardId" value={boardId} />
              {groupId ? <input type="hidden" name="groupId" value={groupId} /> : null}
              <button
                type="submit"
                disabled={pending}
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-mw-tint-blue text-sm font-semibold text-mw-primary  "
                >
                  {company.name.trim().charAt(0) || "?"}
                </span>
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-sm">{company.name}</b>
                  <span className="block truncate text-[11px] text-mw-sub">
                    {[company.owner_name, company.biz_type, company.region, company.phone].filter(Boolean).join(" · ") || "저장된 정보 없음"}
                  </span>
                </span>
                <span className="flex-none text-right text-[11px]">
                  {dealCount > 0 ? (
                    <b className="font-semibold text-mw-primary ">진행 이력 {dealCount}건</b>
                  ) : (
                    <span className="text-mw-sub">이력 없음</span>
                  )}
                </span>
              </button>
            </form>
          </li>
        ))}

        {!loadError && shown.length === 0 ? (
          <li className="px-3 py-6 text-center text-sm text-mw-sub">
            «{query.trim()}» 로 찾은 업체가 없습니다
            {truncated ? (
              <>
                <br />
                <span className="text-[11px]">
                  다만 지금은 업체 목록의 <b>일부만</b> 보고 있습니다 — 없다고 단정하지 마세요.
                </span>
              </>
            ) : null}
          </li>
        ) : null}
      </ul>

      {state.message ? (
        <p
          role={state.ok ? "status" : "alert"}
          className={`text-xs ${state.ok ? "text-[var(--mw-success)]" : "text-[var(--mw-error)]"}`}
        >
          {state.message}
        </p>
      ) : null}

      {/*
        새 업체 등록은 «맨 아래» 다. 목업도 같다 — 위에 두면 찾아보기 전에 눌러서 중복이 는다.
        지금은 회사 등록 경로가 따로 있으므로(회사 CSV 가져오기·리드컨택에서 넘어옴) 그리로 보낸다.
      */}
      {!loadError ? <p className="text-[11px] text-mw-sub">
        이미 있는 업체를 고르면 <b>저장된 정보가 그대로 채워집니다</b> — 같은 회사를 두 번 적지 않게.
        <br />
        {/*
          ★ 잘렸을 때 안내를 «교체» 하지 않고 «앞에 덧붙인다».
            교체하면 회사가 많은 조직은 진짜로 없는 회사를 만나도 「등록해 주세요」를
            영영 못 본다 — 막다른 길이 된다. 순서만 바꾼다: 먼저 찾아보고, 그래도 없으면 등록.
        */}
        {truncated ? (
          <>
            이 목록에는 <b>{rows.length}곳</b>이 담겨 있습니다 — 전부가 아닐 수 있으니 안 보여도 없는 게 아니에요.
            <br />
          </>
        ) : null}
        찾는 업체가 없다면{" "}
        <Link href={companiesHref} className="underline underline-offset-2">업체관리 현황</Link>
        {truncated ? "에서 먼저 찾아보고, 거기에도 없으면 등록해 주세요." : "에서 먼저 등록해 주세요."}
      </p> : null}
      </>
      ) : (
        <NewCompanyPanel
          companyName={companyName}
          onCompanyName={setCompanyName}
          businessType={businessType}
          onBusinessType={(next) => { setBusinessType(next); setBusinessSubtype("일반"); }}
          businessSubtype={businessSubtype}
          onBusinessSubtype={setBusinessSubtype}
          businessCustom={businessCustom}
          onBusinessCustom={setBusinessCustom}
          foundedMonth={foundedMonth}
          onFoundedMonth={setFoundedMonth}
          regionSido={regionSido}
          onRegionSido={(next) => { setRegionSido(next); setRegionSigungu(""); }}
          regionSigungu={regionSigungu}
          onRegionSigungu={setRegionSigungu}
          phone={phone}
          onPhone={setPhone}
          result={newCompanyState}
          pending={newCompanyPending}
          canSubmit={Boolean(startNewCompanyWorkAction)}
          formAction={newCompanyDispatch}
          stampRequest={(event) => {
            if (existingRequest.current) {
              event.preventDefault();
              setRequestNotice("이전 회사의 저장 결과를 먼저 확인해 주세요. 같은 회사로 다시 시도하면 중복 없이 확인합니다.");
              return;
            }
            const field = event.currentTarget.elements.namedItem("workRequestId");
            if (!(field instanceof HTMLInputElement)) return;
            const payload = JSON.stringify([...new FormData(event.currentTarget)].filter(([key]) => key !== "workRequestId"));
            if (newRequest.current?.uncertain && newRequest.current.payload !== payload) {
              event.preventDefault();
              setRequestNotice("저장 결과 확인 전에는 내용을 바꿀 수 없어요. 이전 입력으로 돌린 뒤 다시 시도해 주세요.");
              return;
            }
            if (!newRequest.current || (newRequest.current.confirmed && newRequest.current.payload !== payload)) {
              newRequest.current = { id: newRequestId(), payload, confirmed: false, uncertain: false };
            }
            newRequest.current.uncertain = true;
            field.value = newRequest.current.id;
            setRequestNotice("");
          }}
          existingDispatch={action}
          stampExistingRequest={stampExistingRequest}
          boardId={boardId}
          groupId={groupId}
          inputClassName={inputClassName}
        />
      )}
    </div>
  );
}

/**
 * «새 회사» 등록 패널 — 같은 compact 흐름 안에서 회사 만들기 + 업무 시작까지 잇는다.
 *
 * ★ 중복 방지(서버 `startCompanyWorkFromNewCompanyAction` → 155 원자 intake):
 *   replay가 후보 차단보다 먼저다 — 같은 열쇠+같은 내용은 같은 회사로 수렴한다.
 *   genuinely new 열쇠의 같은 이름은 RPC가 트랜잭션 안에서 막고, 후보는
 *   기존 시작 액션으로만 진행한다(141 같은 회사/새 딜 의미 그대로, 자동 병합 없음).
 *   실패는 전체를 되돌리므로 남는 회사가 없다 — 155 없이는 fail-closed다.
 *   `retryCompanyId` UI는 과거 상태 호환용으로만 남긴다 (서버가 더 보내지 않는다).
 *   입력값은 controlled state 라 실패 뒤에도 그대로 남는다.
 */
function NewCompanyPanel({
  companyName,
  onCompanyName,
  businessType,
  onBusinessType,
  businessSubtype,
  onBusinessSubtype,
  businessCustom,
  onBusinessCustom,
  foundedMonth,
  onFoundedMonth,
  regionSido,
  onRegionSido,
  regionSigungu,
  onRegionSigungu,
  phone,
  onPhone,
  result,
  pending,
  canSubmit,
  formAction,
  stampRequest,
  existingDispatch,
  stampExistingRequest,
  boardId,
  groupId,
  inputClassName,
}: {
  companyName: string;
  onCompanyName: (value: string) => void;
  businessType: string;
  onBusinessType: (value: string) => void;
  businessSubtype: string;
  onBusinessSubtype: (value: string) => void;
  businessCustom: string;
  onBusinessCustom: (value: string) => void;
  foundedMonth: string;
  onFoundedMonth: (value: string) => void;
  regionSido: string;
  onRegionSido: (value: string) => void;
  regionSigungu: string;
  onRegionSigungu: (value: string) => void;
  phone: string;
  onPhone: (value: string) => void;
  result: CompanyIntakeActionState;
  pending: boolean;
  canSubmit: boolean;
  formAction: (formData: FormData) => void;
  stampRequest: (event: React.FormEvent<HTMLFormElement>) => void;
  /**
   * 기존 회사 시작 dispatch — 중복 후보·다시 시작이 같은 멱등 규칙으로 간다.
   * 결과 표시는 새 회사 패널의 useActionState 가 들고 있어 여기서 다시 잡지 않는다.
   */
  existingDispatch: (formData: FormData) => void;
  stampExistingRequest: (event: React.FormEvent<HTMLFormElement>) => void;
  boardId: string;
  groupId: string | null;
  inputClassName?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-mw-sub">
        목록에 없는 회사만 등록하세요 — <b>먼저 «기존 회사» 에서 찾아보세요.</b> 같은 이름이
        있으면 만들지 않고 후보를 보여줍니다.
      </p>
      <form action={formAction} onSubmit={stampRequest} className="flex flex-col gap-2">
        <input type="hidden" name="workRequestId" defaultValue="" />
        <input type="hidden" name="boardId" value={boardId} />
        {groupId ? <input type="hidden" name="groupId" value={groupId} /> : null}
        <label className="flex flex-col gap-1 text-xs font-medium">
          회사 이름 *
          <input
            name="companyName"
            required
            value={companyName}
            onChange={(event) => onCompanyName(event.target.value)}
            placeholder="예: 모아상사"
            aria-label="새 회사 이름"
            disabled={pending}
            className={inputClassName}
          />
        </label>
        {/* 사업자유형 — 신규리드 정본 3종 + 하위구분/자유기재. 값은 서버가 같은 resolve로 저장한다. */}
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs font-medium">
            사업자유형
            <select
              name="businessType"
              value={businessType}
              onChange={(event) => onBusinessType(event.target.value)}
              aria-label="사업자유형"
              disabled={pending}
              className={inputClassName}
            >
              <option value="">선택 안 함</option>
              {NEW_LEAD_BUSINESS_TYPES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          {businessType === "개인사업자" || businessType === "법인사업자" ? (
            <label className="flex flex-col gap-1 text-xs font-medium">
              {businessType === "법인사업자" ? "과세·형태" : "과세유형"}
              <select
                name="businessSubtype"
                value={businessSubtype}
                onChange={(event) => onBusinessSubtype(event.target.value)}
                aria-label={businessType === "법인사업자" ? "법인 과세·형태 구분" : "개인 과세유형 구분"}
                disabled={pending}
                className={inputClassName}
              >
                {(businessType === "법인사업자"
                  ? NEW_LEAD_CORPORATE_BUSINESS_SUBTYPES
                  : NEW_LEAD_PERSONAL_BUSINESS_SUBTYPES
                ).map((option) => (
                  <option key={option} value={option}>
                    {businessType === "법인사업자" && option === "유한" ? "유한(법인 형태)" : option}
                  </option>
                ))}
              </select>
            </label>
          ) : businessType === NEW_LEAD_CUSTOM_BUSINESS_TYPE ? (
            <label className="flex flex-col gap-1 text-xs font-medium">
              어떤 유형인가요
              <input
                name="businessCustom"
                value={businessCustom}
                onChange={(event) => onBusinessCustom(event.target.value)}
                placeholder="예: 비영리법인 · 협동조합"
                aria-label="사업자유형 자유기재"
                disabled={pending}
                className={inputClassName}
              />
            </label>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {/* 창업연월 — 승인 입력. 서버가 같은 달 1일로 founded_on에 저장한다. */}
          <label className="flex flex-col gap-1 text-xs font-medium">
            창업연월
            <input
              type="month"
              name="foundedMonth"
              value={foundedMonth}
              onChange={(event) => onFoundedMonth(event.target.value)}
              aria-label="창업연월"
              disabled={pending}
              className={inputClassName}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            전화번호
            <input
              type="tel"
              name="phone"
              value={phone}
              onChange={(event) => onPhone(event.target.value)}
              placeholder="예: 02-1234-5678"
              aria-label="전화번호"
              disabled={pending}
              className={inputClassName}
            />
          </label>
        </div>
        {/* 지역 — 시도+시군구 정본 검색. 서버가 단일 카탈로그 값으로 합쳐 저장한다. */}
        <div className="grid grid-cols-2 gap-2">
          <RegionCombobox
            name="regionSido"
            label="시도"
            value={regionSido}
            onValue={onRegionSido}
            suggestions={searchSido(regionSido)}
          />
          <RegionCombobox
            name="regionSigungu"
            label="시군구"
            value={regionSigungu}
            onValue={onRegionSigungu}
            suggestions={searchSigungu(regionSido, regionSigungu)}
            disabled={!canonicalSido(regionSido)}
          />
        </div>
        <button
          type="submit"
          disabled={pending || !canSubmit}
          title={canSubmit ? undefined : "새 회사 등록 동작이 연결되지 않았어요"}
          className="rounded bg-mw-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {pending ? "등록 중…" : "새 회사 등록하고 업무 시작"}
        </button>
      </form>

      {result.message ? (
        <p
          role={result.ok ? "status" : "alert"}
          className={`text-xs ${result.ok ? "text-[var(--mw-success)]" : "text-[var(--mw-error)]"}`}
        >
          {result.message}
        </p>
      ) : null}

      {result.conflictCandidates && result.conflictCandidates.length > 0 ? (
        <ConflictCandidates
          candidates={result.conflictCandidates}
          existingDispatch={existingDispatch}
          stampExistingRequest={stampExistingRequest}
          boardId={boardId}
          groupId={groupId}
        />
      ) : null}

      {result.retryCompanyId && result.retryRequestId ? (
        <form action={existingDispatch} onSubmit={stampExistingRequest} aria-label="등록된 회사로 다시 시작">
          <input type="hidden" name="companyId" value={result.retryCompanyId} />
          {/* 같은 열쇠를 그대로 쓴다 — 비어 있을 때만 채우는 stampRequestId 가 값을 살린다. */}
          <input type="hidden" name="requestId" defaultValue={result.retryRequestId} />
          <input type="hidden" name="boardId" value={boardId} />
          {groupId ? <input type="hidden" name="groupId" value={groupId} /> : null}
          <button
            type="submit"
            className="rounded border border-mw-line px-3 py-1.5 text-xs font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            다시 시작 — 같은 회사로 한 번만
          </button>
        </form>
      ) : null}
    </div>
  );
}

/**
 * 중복 후보 — 만들지 않고 «고르게만» 보여준다. 자동 병합 없음.
 * 후보를 누르면 기존 회사 시작과 같은 액션·같은 멱등 규칙으로 진행한다.
 */
function ConflictCandidates({
  candidates,
  existingDispatch,
  stampExistingRequest,
  boardId,
  groupId,
}: {
  candidates: readonly NewCompanyCandidate[];
  existingDispatch: (formData: FormData) => void;
  stampExistingRequest: (event: React.FormEvent<HTMLFormElement>) => void;
  boardId: string;
  groupId: string | null;
}) {
  return (
    <ul className="flex flex-col gap-1" aria-label="같은 이름의 회사 후보">
      {candidates.map((candidate) => (
        <li key={candidate.id} className="flex items-center gap-2 rounded border border-mw-line px-2 py-1">
          <span className="min-w-0 flex-1">
            <b className="block truncate text-xs">{candidate.name}</b>
            {candidate.detail ? (
              <span className="block truncate text-[11px] text-mw-sub">{candidate.detail}</span>
            ) : null}
          </span>
          <form action={existingDispatch} onSubmit={stampExistingRequest}>
            <input type="hidden" name="companyId" value={candidate.id} />
            <input type="hidden" name="requestId" defaultValue="" />
            <input type="hidden" name="boardId" value={boardId} />
            {groupId ? <input type="hidden" name="groupId" value={groupId} /> : null}
            <button type="submit" className="flex-none text-xs font-semibold text-mw-primary">
              이 회사로 진행
            </button>
          </form>
        </li>
      ))}
    </ul>
  );
}
