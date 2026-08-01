"use client";

import { useState } from "react";
import { applyCsv, createCsvDryRun, rollbackCsv, saveBuilder } from "@/lib/dynamic-workspace/workspace-ops-actions";
import type { WorkspaceOpsSnapshot } from "@/lib/dynamic-workspace/workspace-ops";
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
  const [notice, setNotice] = useState(snapshot.readError ?? "서버에서 불러온 보드를 선택하세요.");
  const ready = !snapshot.readError && snapshot.boards.length > 0;
  const preview = parseDeidentifiedCsvPreview(csv);
  const rows = csv.split(/\r?\n/).filter(Boolean).slice(1).map((line) => ({ title: line.split(",")[0]?.trim(), values: {} })).filter((row) => row.title);
  const save = async () => setNotice((await saveBuilderAction({ tabs: label ? [{ id: crypto.randomUUID(), label, boardId }] : [] }, crypto.randomUUID())).message);
  const dryRun = async () => { const id = crypto.randomUUID(); const result = await createCsvDryRunAction(id, boardId, rows, crypto.randomUUID()); if (result.ok) setBatchId(id); setNotice(result.message); };
  const apply = async () => { if (batchId) { const result = await applyCsv(batchId); if (result.ok) setApplied(true); setNotice(result.message); } };
  const rollback = async () => { if (batchId) { const result = await rollbackCsv(batchId); if (result.ok) setApplied(false); setNotice(result.message); } };
  return <section className={styles.surface} aria-labelledby="builder-title"><header className={styles.header}><div><p className={styles.eyebrow}>Workspace 설정 · Owner 전용</p><h1 id="builder-title">우리 팀 업무 구조 만들기</h1><p className={styles.description}>저장 버전: {snapshot.builder?.version ?? "없음"}</p></div><span className={styles.status}>서버 연결</span></header><p className={styles.notice} role="status">{notice}</p><section className={styles.panel}><label>구조 이름<input value={label} onChange={(event) => setLabel(event.target.value)} /></label><label>서버 보드<select value={boardId} onChange={(event) => setBoardId(event.target.value)}>{snapshot.boards.map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}</select></label><button type="button" className={styles.primary} disabled={!ready} onClick={save}>구조 저장</button></section><section className={styles.panel}><p className={styles.eyebrow}>CSV 가져오기</p><textarea value={csv} onChange={(event) => setCsv(event.target.value)} placeholder="비식별 CSV"/><p>{preview.rows}개 행 · 격리 {preview.quarantined}개</p><div className={styles.actions}><button type="button" className={styles.secondary} disabled={!ready || rows.length === 0} onClick={dryRun}>dry-run 만들기</button><button type="button" className={styles.primary} disabled={!batchId || applied} onClick={apply}>CSV 적용</button><button type="button" className={styles.secondary} disabled={!batchId || !applied} onClick={rollback}>되돌리기</button></div></section></section>;
}
