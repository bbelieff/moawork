"use client";

import { useState } from "react";
import { pipelineStructureAction, type PipelineStructureResult } from "@/app/(app)/boards/pipeline-structure-actions";
import { ResultBanner } from "@/lib/ui/ResultBanner";

export function NewLeadPipelineRepair({ itemId }: { itemId: string }) {
  const [result, setResult] = useState<PipelineStructureResult | null>(null);
  const [pending, setPending] = useState(false);
  async function run(apply: boolean) {
    if (pending) return;
    setPending(true);
    try {
      setResult(await pipelineStructureAction({
        itemId, apply, pipelineId: apply ? result?.pipelineId : undefined,
        missing: apply ? result?.missing : undefined,
      }));
    } catch {
      // A lost response may already have committed. Require a fresh read, not a blind retry.
      setResult({ ok: false, message: "단계 구성 결과를 확인하지 못했습니다. 다시 조회해 주세요." });
    } finally { setPending(false); }
  }
  return <div className="mt-2 max-w-80 whitespace-normal text-xs">
    {result ? <ResultBanner notice={result} okClassName="text-mw-body" errorClassName="text-mw-error" /> : null}
    {result?.ok && result.missing?.length ? <>
      <p className="my-2 text-mw-body">{result.pipelineName} · 추가: {result.missing.map((kind) => kind === "meeting" ? "상담" : "실무").join(", ")}</p>
      <button type="button" disabled={pending} onClick={() => void run(true)} className="rounded border border-mw-line px-2 py-1 font-semibold disabled:opacity-50">기본 상담·실무 단계 추가</button>
    </> : <button type="button" disabled={pending} onClick={() => void run(false)} className="mt-1 rounded border border-mw-line px-2 py-1 disabled:opacity-50">단계 구성 확인</button>}
  </div>;
}
