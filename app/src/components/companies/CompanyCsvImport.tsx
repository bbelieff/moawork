"use client";

import { useRef, useState } from "react";
import { parseDeidentifiedCsv } from "@/components/workspace-builder/CsvImportDialog";
import { mapCsvToCompanies, IMPORT_ROW_CAP } from "@/lib/companies/csv-import";
import type { CompanyImportResult } from "@/app/(app)/companies/csv-import-contract";

/**
 * 고객사 CSV 가져오기.
 *
 * ★ 파서(parseDeidentifiedCsv)는 /platform/demo 에서 이미 «동작하던» 것을 그대로 쓴다.
 *   새로 쓰지 않는다. 다른 것은 «어디에 저장하는가» 와 «문구» 뿐이다 —
 *   데모 쪽은 「합성 데이터만」이라고 말해야 하고 여기는 실제 고객사를 받는다.
 *
 * ★★ 막다른 길을 만들지 않는다:
 *   · 파일을 고른 뒤에도 «다른 파일 고르기» 로 되돌아갈 수 있다
 *   · 미리보기에서 무엇이 들어가고 무엇이 빠지는지 «미리» 보인다
 *   · 실패해도 어디까지 들어갔는지 목록으로 남는다
 */
export function CompanyCsvImport({
  importCsv,
}: Readonly<{
  importCsv: (
    rows: readonly { title: string; values: Record<string, string> }[],
    headers: readonly string[],
    requestId: string,
  ) => Promise<CompanyImportResult>;
}>) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const requestIdRef = useRef("");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<{ title: string; values: Record<string, string> }[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CompanyImportResult | null>(null);
  const [notice, setNotice] = useState("첫 줄은 열 이름이어야 해요. 회사명·대표자명·전화번호 같은 이름을 알아봅니다.");

  const preview = rows.length > 0 ? mapCsvToCompanies(rows, headers) : null;

  const reset = () => {
    setFileName(""); setRows([]); setHeaders([]); setResult(null);
    requestIdRef.current = "";
    setNotice("첫 줄은 열 이름이어야 해요. 회사명·대표자명·전화번호 같은 이름을 알아봅니다.");
  };
  const close = () => { dialogRef.current?.close(); triggerRef.current?.focus(); };

  const readFile = async (file?: File) => {
    setResult(null);
    if (!file) { setNotice("CSV 파일을 선택해 주세요."); return; }
    if (file.size > 1024 * 1024) { setNotice("CSV 파일은 1MB 이하만 가져올 수 있어요."); return; }
    const text = await file.text();
    const parsed = parseDeidentifiedCsv(text);
    if (parsed.rows.length === 0) {
      setFileName(file.name); setRows([]); setHeaders([]);
      setNotice(`읽을 수 있는 행이 없어요. 격리된 행 ${parsed.quarantined}개 — 첫 줄이 열 이름인지 확인해 주세요.`);
      return;
    }
    // 파서는 헤더를 돌려주지 않으므로 첫 줄에서 직접 뽑는다(파서와 같은 규칙).
    const firstLine = text.replace(/^﻿/, "").split(/\r?\n/)[0] ?? "";
    const parsedHeaders = firstLine.split(",").map((value) => value.trim().replace(/^"|"$/g, ""));
    requestIdRef.current = crypto.randomUUID();
    setFileName(file.name); setRows(parsed.rows); setHeaders(parsedHeaders);
    setNotice(`${parsed.rows.length}개 행을 읽었어요.${parsed.quarantined ? ` 형식이 안 맞는 ${parsed.quarantined}행은 제외했어요.` : ""}`);
  };

  const submit = async () => {
    if (busy || rows.length === 0) return;
    setBusy(true);
    try {
      const outcome = await importCsv(rows, headers, requestIdRef.current);
      setResult(outcome);
      if (outcome.ok && !outcome.duplicate) { setRows([]); setHeaders([]); setFileName(""); }
    } catch {
      setResult({
        ok: false,
        message: "저장 여부를 확인할 수 없어요. 같은 파일을 다시 가져와도 중복 저장되지 않아요.",
        imported: 0,
        rejected: [],
      });
    } finally { setBusy(false); }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
      >
        CSV로 가져오기
      </button>
      <dialog
        ref={dialogRef}
        onClose={() => { triggerRef.current?.focus(); }}
        className="w-[min(38rem,92vw)] rounded-2xl border border-zinc-200 bg-white p-0 text-zinc-950 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
      >
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div>
            <p className="text-sm font-medium text-violet-700 dark:text-violet-300">고객사</p>
            <h2 className="mt-0.5 text-lg font-semibold">CSV로 가져오기</h2>
          </div>
          <button type="button" aria-label="닫기" onClick={close} className="rounded-lg px-2 py-1 text-xl text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">×</button>
        </div>

        <div className="flex flex-col gap-3 px-5 py-4">
          <label className="flex cursor-pointer flex-col gap-1 rounded-xl border border-dashed border-zinc-300 px-4 py-5 text-sm dark:border-zinc-700">
            <span className="font-medium">CSV 파일 선택</span>
            <input type="file" accept=".csv,text/csv" className="text-sm" onChange={(event) => void readFile(event.target.files?.[0])} />
            <span className="text-xs text-zinc-500">{fileName || `최대 1MB · 한 번에 ${IMPORT_ROW_CAP}행까지`}</span>
          </label>

          <p role="status" className="text-sm text-zinc-600 dark:text-zinc-300">{notice}</p>

          {preview ? (
            <div className="rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-800">
              <p className="font-medium">{preview.mapped.length}건이 들어갑니다</p>
              {preview.rejected.length > 0 ? (
                <p className="mt-1 text-amber-700 dark:text-amber-300">{preview.rejected.length}행은 회사명이 없어 제외됩니다.</p>
              ) : null}
              {preview.unrecognized.length > 0 ? (
                <p className="mt-1 text-zinc-500">알아보지 못한 열은 저장하지 않아요: {preview.unrecognized.join(", ")}</p>
              ) : null}
              <ul className="mt-2 grid gap-1 text-xs text-zinc-500">
                {preview.mapped.slice(0, 3).map((row, index) => (
                  <li key={index}>· {row.input.name}{row.input.owner_name ? ` — ${row.input.owner_name}` : ""}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {result ? (
            <div role="status" className={`rounded-xl p-3 text-sm ${result.ok ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100" : "bg-rose-50 text-rose-900 dark:bg-rose-950 dark:text-rose-100"}`}>
              <p className="font-medium">{result.message}</p>
              {result.rejected.length > 0 ? (
                <ul className="mt-2 grid gap-1 text-xs">
                  {result.rejected.slice(0, 5).map((row) => (
                    <li key={`${row.line}-${row.title}`}>{row.line}행 · {row.title || "(이름 없음)"} — {row.reason}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-4 dark:border-zinc-800">
          {/* 막다른 길 방지 — 파일을 고른 뒤에도 되돌아갈 수 있다 */}
          <button type="button" onClick={reset} disabled={busy || !fileName} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium disabled:opacity-40 dark:border-zinc-700">
            다시 고르기
          </button>
          <button type="button" onClick={close} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium dark:border-zinc-700">닫기</button>
          <button type="button" onClick={submit} disabled={busy || rows.length === 0} className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">
            {busy ? "가져오는 중…" : "가져오기"}
          </button>
        </div>
      </dialog>
    </>
  );
}
