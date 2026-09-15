"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { rankCompanies, type CompanyPickerRow } from "@/lib/companies/search";
import {
  workspaceBaseFromPathname,
  workspaceHref,
} from "@/components/shell/workspace-href";
import type { CompanyIntakeActionState } from "@/app/(app)/boards/[id]/company-intake-actions";

const INITIAL_ACTION_STATE: CompanyIntakeActionState = { ok: null, message: "" };

/**
 * 멱등 열쇠를 «제출 직전» 에 채운다.
 *
 * ★ 왜 렌더 중이 아닌가 — 두 가지가 동시에 걸린다.
 *   ① 렌더당 하나를 발급하면 모든 행이 같은 열쇠를 쓴다. RPC 의 멱등 열쇠는
 *      (org_id, request_id) 이고 같은 열쇠를 «다른 회사» 로 다시 쓰면 거절한다
 *      (117_bbe237_company_start_work.sql:92 — 'idempotency key reuse', 22023).
 *      즉 회사A 를 고른 직후 회사B 를 고르면 두 번째가 «항상» 거절됐다.
 *      「동일 회사 반복 허용, 동일 request 중복만 차단」을 정확히 뒤집는 형태다.
 *   ② 그렇다고 렌더마다 randomUUID() 를 부르면 서버와 클라이언트가 다른 값을 그려
 *      hydration 이 깨진다.
 *
 *   제출 이벤트에서 «비어 있을 때만» 채우면 둘 다 없다 — 선택 하나가 열쇠 하나를 갖고,
 *   그리는 값은 항상 빈 문자열이며, 진행 중인 한 건의 더블클릭은 같은 열쇠로 묶인다.
 */
function stampRequestId(event: React.FormEvent<HTMLFormElement>) {
  const field = event.currentTarget.elements.namedItem("requestId");
  if (!(field instanceof HTMLInputElement)) return;
  // ★ «비어 있을 때만» 채운다. 이 한 줄이 더블클릭 보호다.
  //   `disabled={pending}` 로는 막히지 않는다 — pending 은 트랜지션 렌더가 커밋된 뒤에야
  //   true 가 되고, 그 커밋은 클릭 자신의 이벤트 디스패치 안에서 일어날 수 없다.
  //   즉 «한 틱 안의 두 번째 클릭» 은 여전히 통과한다. 매번 새 열쇠를 찍으면 그 두 번이
  //   서로 다른 열쇠가 되어 자금 건이 «둘» 생긴다 — 병합·삭제 화면도 없다.
  //   비어 있을 때만 찍으면 진행 중인 한 건은 열쇠가 고정돼 RPC 가 하나로 묶는다.
  //   React 19 는 함수 action 이 끝나면 폼을 자동 리셋하므로 다음 선택은 다시 빈칸이다.
  if (field.value === "") field.value = newRequestId();
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
  const [state, action, pending] = useActionState(startWorkAction, INITIAL_ACTION_STATE);
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
            <form action={action} onSubmit={stampRequestId}>
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
    </div>
  );
}
