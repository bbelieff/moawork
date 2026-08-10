"use client";

// T09 · 정산 수식 화면 — 실행액·수수료% 입력 → 수수료·총매출·D+180/365 표시.
//
// ⚠ 수용기준: **화면에서 재계산하지 않는다.**
//    fee_amount·total_revenue·d180·d365 는 001 의 generated column 이므로,
//    입력을 POST/PATCH 한 뒤 서버가 돌려준 레코드의 값을 **그대로 표시**한다.
//    (클라이언트 산식 사본을 두면 DB 와 갈라질 수 있어 금지.)
//
// 데이터 소스 무관: 실제 호출은 onSubmit 으로 주입받는다(기본값 = /api/settlements).

import { useState } from "react";
import type { OptionCategory } from "@/lib/policyfund";
import { toCreatePayload } from "@/lib/policyfund/settlement-form";
import { OptionSelect } from "./OptionSelect";

/** 서버가 돌려주는 정산 레코드 중 화면이 쓰는 필드. */
export interface SettlementView {
  id?: string;
  // base (입력)
  exec_amount: number;
  fee_pct: number;
  down_payment: number;
  fee_paid_at: string | null;
  // derived (DB generated — 표시 전용)
  fee_amount: number;
  total_revenue: number;
  d180: string | null;
  d365: string | null;
}

/** 폼이 서버로 보내는 입력(base 컬럼만). */
export interface SettlementFormInput {
  exec_amount: number;
  fee_pct: number;
  down_payment: number;
  fee_paid_at: string | null;
  /** 002 프리셋 연결 — 진행상품/진행기관(참조 정보, base 컬럼 아님). */
  product?: string;
  agency?: string;
}

export interface SettlementFormProps {
  /** 002_seed 프리셋 — 진행상품(59). */
  productCategory?: OptionCategory;
  /** 002_seed 프리셋 — 진행기관(18). */
  agencyCategory?: OptionCategory;
  /** 계산 요청. 기본 구현은 POST /api/settlements. */
  onSubmit?: (input: SettlementFormInput) => Promise<SettlementView>;
  /** 초기 표시값(수정 화면 등). */
  initial?: SettlementView | null;
}

/** 기본 제출 — 서버에 저장하고 파생값이 채워진 레코드를 받는다. */
async function postSettlement(input: SettlementFormInput): Promise<SettlementView> {
  const res = await fetch("/api/settlements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // 파생 컬럼은 보내지 않는다(서버가 400 으로 거절). 프리셋 참조도 base 아님 → 제외.
    // 페이로드 구성은 순수 모듈에 위임 — 테스트가 파생키 배제를 고정한다.
    body: JSON.stringify(
      toCreatePayload({
        execAmount: String(input.exec_amount),
        feePct: String(input.fee_pct),
        downPayment: String(input.down_payment),
        feePaidAt: input.fee_paid_at ?? "",
      }),
    ),
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `요청 실패 (${res.status})`;
    throw new Error(message);
  }
  return (body as { data: SettlementView }).data;
}

const won = new Intl.NumberFormat("ko-KR");

/** 금액(원) 표시. */
function Won({ value }: { value: number }) {
  return <span>{won.format(value)}원</span>;
}

/** 파생값 1칸 — 서버 값 그대로. 미산출(null)이면 —. */
function DerivedCell({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className="text-lg font-semibold tabular-nums">{children}</span>
      {hint ? <span className="text-[11px] text-zinc-400">{hint}</span> : null}
    </div>
  );
}

export function SettlementForm({
  productCategory,
  agencyCategory,
  onSubmit,
  initial = null,
}: SettlementFormProps) {
  const [execAmount, setExecAmount] = useState(String(initial?.exec_amount ?? ""));
  const [feePct, setFeePct] = useState(String(initial?.fee_pct ?? ""));
  const [downPayment, setDownPayment] = useState(String(initial?.down_payment ?? ""));
  const [feePaidAt, setFeePaidAt] = useState(initial?.fee_paid_at ?? "");
  const [product, setProduct] = useState("");
  const [agency, setAgency] = useState("");

  const [result, setResult] = useState<SettlementView | null>(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = onSubmit ?? postSettlement;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const view = await submit({
        exec_amount: Number(execAmount || 0),
        fee_pct: Number(feePct || 0),
        down_payment: Number(downPayment || 0),
        fee_paid_at: feePaidAt === "" ? null : feePaidAt,
        product: product || undefined,
        agency: agency || undefined,
      });
      setResult(view);
    } catch (err) {
      setError(err instanceof Error ? err.message : "계산에 실패했습니다");
      setResult(null);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label htmlFor="exec_amount" className="flex flex-col gap-1 text-sm">
          <span className="font-medium">실행액 (원)</span>
          <input
            id="exec_amount"
            name="exec_amount"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={execAmount}
            onChange={(e) => setExecAmount(e.target.value)}
            className="rounded-md border border-zinc-300 px-3 py-2 tabular-nums dark:border-zinc-600 dark:bg-zinc-900"
            placeholder="100000000"
          />
        </label>

        <label htmlFor="fee_pct" className="flex flex-col gap-1 text-sm">
          <span className="font-medium">수수료율 (%)</span>
          <input
            id="fee_pct"
            name="fee_pct"
            type="number"
            min={0}
            max={100}
            step={1}
            inputMode="numeric"
            value={feePct}
            onChange={(e) => setFeePct(e.target.value)}
            className="rounded-md border border-zinc-300 px-3 py-2 tabular-nums dark:border-zinc-600 dark:bg-zinc-900"
            placeholder="3"
          />
          <span className="text-[11px] text-zinc-400">정수 퍼센트 (3 = 3%)</span>
        </label>

        <label htmlFor="down_payment" className="flex flex-col gap-1 text-sm">
          <span className="font-medium">계약금 (원)</span>
          <input
            id="down_payment"
            name="down_payment"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={downPayment}
            onChange={(e) => setDownPayment(e.target.value)}
            className="rounded-md border border-zinc-300 px-3 py-2 tabular-nums dark:border-zinc-600 dark:bg-zinc-900"
            placeholder="500000"
          />
        </label>

        <label htmlFor="fee_paid_at" className="flex flex-col gap-1 text-sm">
          <span className="font-medium">수수료 입금일</span>
          <input
            id="fee_paid_at"
            name="fee_paid_at"
            type="date"
            value={feePaidAt}
            onChange={(e) => setFeePaidAt(e.target.value)}
            className="rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-900"
          />
          <span className="text-[11px] text-zinc-400">D+180 · D+365 기산일</span>
        </label>

        {productCategory ? (
          <OptionSelect
            category={productCategory}
            value={product}
            onChange={setProduct}
            placeholder="진행상품 선택"
          />
        ) : null}

        {agencyCategory ? (
          <OptionSelect
            category={agencyCategory}
            value={agency}
            onChange={setAgency}
            placeholder="진행기관 선택"
          />
        ) : null}
      </div>

      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? "계산 중…" : "정산 계산"}
        </button>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">
          정산 결과
          <span className="ml-2 text-[11px] font-normal text-zinc-400">
            서버(DB generated column) 값 — 화면 재계산 없음
          </span>
        </h3>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <DerivedCell label="수수료" hint="round(실행액 × % / 100)">
            {result ? <Won value={result.fee_amount} /> : "—"}
          </DerivedCell>
          <DerivedCell label="총매출" hint="계약금 + 수수료">
            {result ? <Won value={result.total_revenue} /> : "—"}
          </DerivedCell>
          <DerivedCell label="D+180" hint="수수료입금일 + 180일">
            {result?.d180 ?? "—"}
          </DerivedCell>
          <DerivedCell label="D+365" hint="수수료입금일 + 365일">
            {result?.d365 ?? "—"}
          </DerivedCell>
        </div>
      </section>
    </form>
  );
}
