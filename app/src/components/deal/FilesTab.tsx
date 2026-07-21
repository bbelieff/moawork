"use client";

// T04 · core.files — 딜 상세 '문서' 탭(파일 첨부).
//
// 기획 v0.2 §4 흐름 C: 딜 상세 탭(정보·활동·문서·정산) 중 '문서'.
// MVP = 먼데이 파일 컬럼 재현(업로드/다운로드). 문서함 버전관리·전자서명은 Phase 2.
//
// 로컬 우선: 현재 저장은 @/lib/services/files 의 인메모리 스토어(data URL).
// TODO(T04): Supabase Storage 연결 시 다운로드를 서명 URL(만료)로 교체.
//
// 사용처: T02 의 딜 상세 화면. 업로드/삭제 실행은 상위가 주입한다(서버 액션 등).

import { useRef, useState, useTransition } from "react";
import {
  formatBytes,
  MAX_FILE_BYTES,
  validateUpload,
  type StoredFile,
} from "@/lib/services/files";

export interface FilesTabProps {
  files: StoredFile[];
  /** 업로드 처리(상위에서 서버 액션 등으로 저장). 실패 시 throw. */
  onUpload: (input: {
    name: string;
    mime_type: string;
    size_bytes: number;
    data_url: string;
  }) => void | Promise<void>;
  /** 삭제 처리. 실패 시 throw. */
  onRemove?: (fileId: string) => void | Promise<void>;
  disabled?: boolean;
}

/** File → data URL (로컬 저장용). */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("파일을 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}

export function FilesTab({
  files,
  onUpload,
  onRemove,
  disabled = false,
}: FilesTabProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function pick(fileList: FileList | null) {
    setError(null);
    const file = fileList?.[0];
    if (!file) return;

    // 서버에 보내기 전에 클라이언트에서 1차 차단(크기·확장자).
    const verdict = validateUpload({ name: file.name, size_bytes: file.size });
    if (!verdict.ok) {
      setError(verdict.reason);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    startTransition(async () => {
      try {
        const dataUrl = await readAsDataUrl(file);
        await onUpload({
          name: file.name,
          mime_type: file.type || "application/octet-stream",
          size_bytes: file.size,
          data_url: dataUrl,
        });
        if (inputRef.current) inputRef.current.value = "";
      } catch (e) {
        setError(e instanceof Error ? e.message : "업로드하지 못했습니다.");
      }
    });
  }

  function remove(fileId: string) {
    if (!onRemove) return;
    setError(null);
    startTransition(async () => {
      try {
        await onRemove(fileId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "삭제하지 못했습니다.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          disabled={disabled || pending}
          onChange={(e) => pick(e.target.files)}
          className="text-sm file:mr-3 file:rounded file:border-0 file:bg-zinc-900 file:px-3 file:py-1.5 file:text-xs file:text-white disabled:opacity-60 dark:file:bg-zinc-100 dark:file:text-zinc-900"
        />
        <span className="text-xs text-zinc-400">
          최대 {Math.floor(MAX_FILE_BYTES / 1024 / 1024)}MB · 실행파일 불가
        </span>
      </div>

      {pending ? <p className="text-xs text-zinc-400">처리 중…</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {files.length === 0 ? (
        <p className="rounded border border-dashed border-zinc-200 p-4 text-sm text-zinc-400 dark:border-zinc-800">
          첨부된 파일이 없습니다.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {files.map((f) => (
            <li
              key={f.id}
              className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-zinc-800 dark:text-zinc-100">
                  {f.name}
                </span>
                <span className="text-xs text-zinc-400">
                  {formatBytes(f.size_bytes)} · {f.created_at.slice(0, 10)}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {f.data_url ? (
                  <a
                    href={f.data_url}
                    download={f.name}
                    className="text-xs text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
                  >
                    다운로드
                  </a>
                ) : null}
                {onRemove ? (
                  <button
                    type="button"
                    onClick={() => remove(f.id)}
                    disabled={disabled || pending}
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
