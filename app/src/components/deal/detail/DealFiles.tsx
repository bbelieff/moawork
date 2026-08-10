"use client";

/**
 * 첨부파일 (BBE-16) — 비동기 경로(프로덕션에서도 영속) + 서명 다운로드 URL.
 *
 * 기존 `FilesTab`(T04)과 겹치지 않는 새 컴포넌트다 — 그쪽은 `data_url` 을 직접
 * href 로 노출하는데(§ 저장 자체가 로컬 전용), 이 화면은 절대 원본을 클라이언트
 * 객체에 담지 않고(`DealFileMeta` 에 바이트 없음) `downloadUrl`(만료 서명)만 쓴다.
 */

import { useRef, useState, useTransition } from "react";
import {
  formatBytes,
  MAX_FILE_BYTES,
  validateUpload,
} from "@/lib/services/files";
import type { DealFileMeta } from "@/lib/deal/files";
import {
  attachDealFileAction,
  removeDealFileAction,
} from "@/app/(app)/deals/[dealId]/actions";

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("파일을 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}

export interface DealFilesProps {
  dealId: string;
  files: DealFileMeta[];
  /** 파일별 서명 다운로드 URL(만료 짧음 — 렌더 시점에 서버가 발급). */
  downloadUrlById: Map<string, string>;
  canEdit: boolean;
}

export function DealFiles({ dealId, files, downloadUrlById, canEdit }: DealFilesProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function pick(fileList: FileList | null) {
    setError(null);
    const file = fileList?.[0];
    if (!file) return;

    const verdict = validateUpload({ name: file.name, size_bytes: file.size });
    if (!verdict.ok) {
      setError(verdict.reason);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    startTransition(async () => {
      try {
        const data_url = await readAsDataUrl(file);
        await attachDealFileAction(dealId, {
          name: file.name,
          mime_type: file.type || "application/octet-stream",
          size_bytes: file.size,
          data_url,
        });
        if (inputRef.current) inputRef.current.value = "";
      } catch (e) {
        setError(e instanceof Error ? e.message : "업로드하지 못했습니다.");
      }
    });
  }

  function remove(fileId: string) {
    setError(null);
    startTransition(async () => {
      try {
        await removeDealFileAction(dealId, fileId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "삭제하지 못했습니다.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            disabled={pending}
            onChange={(e) => pick(e.target.files)}
            className="text-sm file:mr-3 file:rounded file:border-0 file:bg-zinc-900 file:px-3 file:py-1.5 file:text-xs file:text-white disabled:opacity-60 dark:file:bg-zinc-100 dark:file:text-zinc-900"
          />
          <span className="text-xs text-zinc-400">
            최대 {Math.floor(MAX_FILE_BYTES / 1024 / 1024)}MB · 다운로드 링크는 잠시 후 만료돼요
          </span>
        </div>
      )}

      {pending ? <p className="text-xs text-zinc-400">처리 중…</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {files.length === 0 ? (
        <p className="rounded border border-dashed border-zinc-200 p-4 text-sm text-zinc-400 dark:border-zinc-800">
          첨부된 파일이 없습니다. 이 건에 붙여두면 나중에 찾아다니지 않아도 돼요.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {files.map((f) => (
            <li
              key={f.id}
              className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-zinc-800 dark:text-zinc-100">{f.name}</span>
                <span className="text-xs text-zinc-400">
                  {formatBytes(f.size_bytes)} · {f.created_at.slice(0, 10)}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {downloadUrlById.has(f.id) ? (
                  <a
                    href={downloadUrlById.get(f.id)}
                    download={f.name}
                    className="text-xs text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
                  >
                    다운로드
                  </a>
                ) : null}
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => remove(f.id)}
                    disabled={pending}
                    className="text-xs text-red-600 hover:underline disabled:opacity-60"
                  >
                    삭제
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
