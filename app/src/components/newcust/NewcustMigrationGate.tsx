"use client";

import { useState, useTransition } from "react";
import { applyNewcustLegacyMigration, dryRunNewcustLegacyMigration } from "@/app/(app)/newcust/migration-actions";
import type { LegacyDryRunResult } from "@/lib/newcust/legacy-types";

export function NewcustMigrationGate({ canApply }: { canApply: boolean }) {
  const [dryRun, setDryRun] = useState<LegacyDryRunResult | null>(null);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const safe = dryRun && dryRun.schema_ok && dryRun.quarantine === 0 && dryRun.conflict === 0 && dryRun.missing === 0;
  return <main aria-labelledby="newcust-migration-title">
    <h1 id="newcust-migration-title">신규 업체 데이터 준비</h1>
    <p>기존 CRM은 읽기 전용으로 보존하며, 검증된 일회 이관이 끝나기 전에는 보드를 열지 않습니다.</p>
    <button disabled={pending} onClick={() => startTransition(async () => { try { setDryRun(await dryRunNewcustLegacyMigration()); setMessage("dry-run을 완료했습니다."); } catch (error) { setMessage(error instanceof Error ? error.message : "dry-run 실패"); } })}>Dry-run 실행</button>
    {dryRun && <><dl><dt>원본</dt><dd>{dryRun.source}</dd><dt>이관 예정</dt><dd>{dryRun.inserted}</dd><dt>업데이트</dt><dd>{dryRun.update}</dd><dt>동일</dt><dd>{dryRun.unchanged}</dd><dt>격리</dt><dd>{dryRun.quarantine}</dd><dt>누락</dt><dd>{dryRun.missing}</dd><dt>충돌</dt><dd>{dryRun.conflict}</dd></dl><p>격리 사유: {Object.entries(dryRun.quarantine_reasons).map(([reason, count]) => `${reason} ${count}`).join(", ") || "없음"}</p><details><summary>검증 샘플({dryRun.sample.length})</summary><ul>{dryRun.sample.map((entry) => <li key={entry.ordinal}>#{entry.ordinal} · {entry.mapped ? "매핑 확인" : "미확인"}</li>)}</ul></details></>}
    {dryRun && dryRun.quarantine_sample.length > 0 && <details><summary>격리 검토 목록({dryRun.quarantine_sample.length})</summary><ul>{dryRun.quarantine_sample.map((entry) => <li key={entry.ordinal}>#{entry.ordinal} · {entry.reason}</li>)}</ul></details>}
    <button disabled={pending || !safe} title={safe ? "검증된 checksum으로 일회 이관" : "격리·누락·충돌 및 schema 오류가 0이어야 합니다."} onClick={() => startTransition(async () => { if (!dryRun) return; try { await applyNewcustLegacyMigration(dryRun.source_checksum); location.reload(); } catch (error) { setMessage(error instanceof Error ? error.message : "이관 실패"); } })}>검증 후 이관 적용</button>
    {!canApply && <p role="note">이관 실행은 소유자 또는 관리자에게 요청해 주세요. 서버에서도 실행이 거부됩니다.</p>}
    <p role="status">{pending ? "처리 중" : message}</p>
  </main>;
}
