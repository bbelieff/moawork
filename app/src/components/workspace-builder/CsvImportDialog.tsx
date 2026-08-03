"use client";

import { useRef, useState } from "react";
import type { WorkspaceOpsAction } from "@/lib/dynamic-workspace/workspace-ops-actions";
import { STAGE_BOARDS } from "@/lib/crm/stageBoards";
import styles from "./builder-workspace.module.css";

export type CsvRow = Readonly<{ title: string; values: Record<string, string> }>;

function csvRecords(text: string): { records: string[][]; malformed: boolean } {
  const records: string[][] = [];
  let record: string[] = [], field = "", quoted = false, malformed = false, fieldStarted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted && char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
    else if (char === '"') { if (!quoted && fieldStarted) malformed = true; else quoted = !quoted; }
    else if (char === "," && !quoted) { record.push(field); field = ""; fieldStarted = false; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      record.push(field); records.push(record); record = []; field = ""; fieldStarted = false;
    } else { field += char; fieldStarted = true; }
  }
  if (field.length > 0 || record.length > 0) { record.push(field); records.push(record); }
  return { records: records.filter((row) => row.some((value) => value.trim())), malformed: malformed || quoted };
}

export function parseDeidentifiedCsv(text: string): { rows: CsvRow[]; quarantined: number } {
  const parsed = csvRecords(text.replace(/^\uFEFF/, ""));
  const records = parsed.records;
  if (parsed.malformed) return { rows: [], quarantined: Math.max(1, records.length - 1) };
  if (records.length < 2) return { rows: [], quarantined: 0 };
  const headers = records[0].map((value) => value.trim());
  if (headers.some((value) => !value) || new Set(headers).size !== headers.length) return { rows: [], quarantined: records.length - 1 };
  const rows: CsvRow[] = [];
  let quarantined = 0;
  for (const cells of records.slice(1)) {
    if (cells.length !== headers.length || !cells[0].trim()) { quarantined += 1; continue; }
    rows.push({ title: cells[0].trim(), values: Object.fromEntries(headers.slice(1).map((header, index) => [header, cells[index + 1]?.trim() ?? ""])) });
  }
  return { rows, quarantined };
}

export function CsvImportDialog({ activeBoard, importCsv }: Readonly<{
  activeBoard: string;
  importCsv: (boardSlug: string, rows: readonly CsvRow[], requestId: string) => Promise<WorkspaceOpsAction>;
}>) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const requestIdRef = useRef(crypto.randomUUID());
  const [boardSlug, setBoardSlug] = useState(activeBoard);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [quarantined, setQuarantined] = useState(0);
  const [notice, setNotice] = useState("합성·테스트 데이터만 업로드해 주세요. 실제 고객 개인정보는 사용할 수 없어요.");
  const [busy, setBusy] = useState(false);
  const resetFile = () => { setFileName(""); setRows([]); setQuarantined(0); requestIdRef.current = crypto.randomUUID(); };
  const close = () => { dialogRef.current?.close(); triggerRef.current?.focus(); };
  const readFile = async (file?: File) => {
    resetFile();
    if (!file) { setNotice("CSV 파일을 선택해 주세요."); return; }
    if (file.size > 1024 * 1024) { setNotice("CSV 파일은 1MB 이하만 가져올 수 있어요."); return; }
    const parsed = parseDeidentifiedCsv(await file.text());
    setFileName(file.name); setRows(parsed.rows); setQuarantined(parsed.quarantined);
    setNotice(`${parsed.rows.length}개 행을 읽었어요. 가져오면 현재 데모 CRM에 바로 저장됩니다.`);
  };
  const submit = async () => {
    if (busy || rows.length === 0) return;
    setBusy(true);
    try { const result = await importCsv(boardSlug, rows, requestIdRef.current); setNotice(result.message); if (result.ok) resetFile(); }
    catch { setNotice("저장 여부를 확인할 수 없어요. 다시 시도해도 중복 저장되지 않아요."); }
    finally { setBusy(false); }
  };
  return <>
    <button ref={triggerRef} type="button" className={styles.primary} onClick={() => dialogRef.current?.showModal()}>CSV 가져오기</button>
    <dialog ref={dialogRef} className={styles.dialog} onClose={() => triggerRef.current?.focus()}>
      <div className={styles.dialogHeader}><div><p className={styles.eyebrow}>데모 데이터</p><h2>CSV 가져오기</h2></div><button type="button" className={styles.iconButton} aria-label="닫기" onClick={close}>×</button></div>
      <div className={styles.dialogContent}>
        <label>가져올 CRM 보드<select value={boardSlug} onChange={(event) => setBoardSlug(event.target.value)}>{STAGE_BOARDS.map((board) => <option key={board.slug} value={board.slug}>{board.title}</option>)}</select></label>
        <label className={styles.fileDrop}>CSV 파일 선택<input type="file" accept=".csv,text/csv" onChange={(event) => void readFile(event.target.files?.[0])} /><span>{fileName || "첫 번째 열은 항목 이름으로 사용됩니다 · 최대 1MB"}</span></label>
        <p className={styles.notice} role="status">{notice}</p>{fileName ? <p className={styles.preview}>{rows.length}개 행 · 격리 {quarantined}개</p> : null}
      </div>
      <div className={styles.dialogActions}><button type="button" className={styles.secondary} onClick={close}>취소</button><button type="button" className={styles.primary} onClick={submit} disabled={busy || rows.length === 0}>{busy ? "가져오는 중…" : "CRM으로 가져오기"}</button></div>
    </dialog>
  </>;
}
