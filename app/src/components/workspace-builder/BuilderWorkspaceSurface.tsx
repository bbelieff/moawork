"use client";

import { useState } from "react";
import { applyCsv, createCsvDryRun, rollbackCsv, saveBuilder } from "@/lib/dynamic-workspace/workspace-ops-actions";
import type { WorkspaceOpsSnapshot } from "@/lib/dynamic-workspace/workspace-ops";
import { noticeLive, noticeRole, type ResultNotice } from "@/lib/ui/result-notice";
import styles from "./builder-workspace.module.css";

type BuilderAction = typeof saveBuilder;
type CsvDryRunAction = typeof createCsvDryRun;

export function parseDeidentifiedCsvPreview(text: string): { rows: number; quarantined: number } {
  const rows = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (rows.length < 2) return { rows: 0, quarantined: 0 };
  const width = rows[0].split(",").length;
  const quarantined = rows.slice(1).filter((row) => row.split(",").length !== width).length;
  return { rows: rows.length - 1 - quarantined, quarantined };
}

export function BuilderWorkspaceSurface({
  snapshot,
  saveBuilderAction = saveBuilder,
  createCsvDryRunAction = createCsvDryRun,
}: Readonly<{
  snapshot: WorkspaceOpsSnapshot;
  saveBuilderAction?: BuilderAction;
  createCsvDryRunAction?: CsvDryRunAction;
}>) {
  const [label, setLabel] = useState("");
  const [boardId, setBoardId] = useState(snapshot.boards[0]?.id ?? "");
  const [csv, setCsv] = useState("");
  const [batchId, setBatchId] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  // BBE-208: 읽기 실패(readError)와 안내를 한 문자열로 뭉개지 않는다. ok 가 role·색을 함께 가른다.
  const [notice, setNotice] = useState<ResultNotice>(snapshot.readError ? { ok: false, message: snapshot.readError } : { ok: true, message: "업무 구조를 만들 보드를 선택해 주세요." });
  const ready = !snapshot.readError && snapshot.boards.length > 0;
  const preview = parseDeidentifiedCsvPreview(csv);
  const rows = csv.split(/\r?\n/).filter(Boolean).slice(1).map((line) => ({ title: line.split(",")[0]?.trim(), values: {} })).filter((row) => row.title);
  const save = async () => { const result = await saveBuilderAction({ tabs: label ? [{ id: crypto.randomUUID(), label, boardId }] : [] }, crypto.randomUUID()); setNotice({ ok: result.ok, message: result.message }); };
  const dryRun = async () => { const id = crypto.randomUUID(); const result = await createCsvDryRunAction(id, boardId, rows, crypto.randomUUID()); if (result.ok) setBatchId(id); setNotice({ ok: result.ok, message: result.message }); };
  const apply = async () => { if (batchId) { const result = await applyCsv(batchId); if (result.ok) setApplied(true); setNotice({ ok: result.ok, message: result.message }); } };
  const rollback = async () => { if (batchId) { const result = await rollbackCsv(batchId); if (result.ok) setApplied(false); setNotice({ ok: result.ok, message: result.message }); } };
  return <section className={styles.surface} aria-labelledby="builder-title"><header className={styles.header}><div><p className={styles.eyebrow}>회사 대표 전용</p><h1 id="builder-title">마이그레이션</h1><p className={styles.description}>기존 업무 구조와 CSV 항목을 모아워크로 안전하게 옮깁니다. 저장된 설정: {snapshot.builder?.version ? `${snapshot.builder.version}번째` : "아직 없음"}</p></div><span className={styles.status}>연결됨</span></header><p className={notice.ok ? styles.notice : styles.noticeError} role={noticeRole(notice.ok)} aria-live={noticeLive(notice.ok)}>{notice.message}</p><section className={styles.panel}><label>이관 구조 이름<input value={label} onChange={(event) => setLabel(event.target.value)} /></label><label>연결할 보드<select value={boardId} onChange={(event) => setBoardId(event.target.value)}>{snapshot.boards.map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}</select></label><button type="button" className={styles.primary} disabled={!ready} onClick={save}>이관 구조 저장하기</button></section><section className={styles.panel}><p className={styles.eyebrow}>파일로 항목 가져오기</p><textarea value={csv} onChange={(event) => setCsv(event.target.value)} placeholder="개인정보를 지운 CSV 내용을 붙여 넣어 주세요"/><p>{preview.rows}개 항목 · 확인 필요 {preview.quarantined}개</p><div className={styles.actions}><button type="button" className={styles.secondary} disabled={!ready || rows.length === 0} onClick={dryRun}>가져올 내용 확인하기</button><button type="button" className={styles.primary} disabled={!batchId || applied} onClick={apply}>항목 가져오기</button><button type="button" className={styles.secondary} disabled={!batchId || !applied} onClick={rollback}>가져오기 취소하기</button></div></section></section>;
}
