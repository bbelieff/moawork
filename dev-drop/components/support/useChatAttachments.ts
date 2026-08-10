"use client";

// 채팅 첨부 훅 — Ctrl+V 붙여넣기 · 드래그&드롭 · 파일 선택을 한 곳에서 처리한다.
// 고객 위젯과 운영자 어드민 화면이 **같은 훅**을 쓴다(동작이 갈리면 안 된다).
//
// 작성: MWC(코워크). 업로드 전송 자체는 호출부(서버 API)가 맡는다.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_FILES_PER_MESSAGE,
  type AttachmentKind,
  partitionAttachments,
  pastedFileName,
} from "./attachment-rules";

export type PendingAttachment = {
  id: string;
  file: File;
  kind: AttachmentKind;
  /** 미리보기용 objectURL — 제거 시 반드시 revoke 한다(메모리 누수 방지) */
  previewUrl: string;
};

type Options = {
  /** 거절 사유를 사용자에게 알릴 때 호출(토스트 등) */
  onReject?: (messages: string[]) => void;
};

export function useChatAttachments({ onReject }: Options = {}) {
  const [items, setItems] = useState<PendingAttachment[]>([]);
  const [isDragging, setDragging] = useState(false);
  const itemsRef = useRef<PendingAttachment[]>([]);
  itemsRef.current = items;

  // 언마운트 시 objectURL 정리
  useEffect(() => {
    return () => {
      for (const item of itemsRef.current) URL.revokeObjectURL(item.previewUrl);
    };
  }, []);

  const add = useCallback(
    (incoming: File[]) => {
      if (incoming.length === 0) return;

      const { accepted, rejected } = partitionAttachments(incoming, itemsRef.current.length);

      if (rejected.length > 0) {
        // 조용히 버리지 않는다 — 왜 안 됐는지 알려준다.
        onReject?.(rejected.map((r) => `${r.file.name ?? "파일"} — ${r.reason}`));
      }

      if (accepted.length === 0) return;

      setItems((prev) => [
        ...prev,
        ...accepted.map(({ file, kind }) => ({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          file,
          kind,
          previewUrl: URL.createObjectURL(file),
        })),
      ]);
    },
    [onReject],
  );

  const remove = useCallback((id: string) => {
    setItems((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((item) => item.id !== id);
    });
  }, []);

  const clear = useCallback(() => {
    setItems((prev) => {
      for (const item of prev) URL.revokeObjectURL(item.previewUrl);
      return [];
    });
  }, []);

  /**
   * ★ Ctrl+V — 클립보드에 이미지가 있으면 파일로 만들어 담는다.
   * 텍스트를 복사한 경우에는 아무것도 하지 않는다(기본 붙여넣기 유지).
   */
  const onPaste = useCallback(
    (event: React.ClipboardEvent) => {
      const clipboard = event.clipboardData;
      if (!clipboard) return;

      const files: File[] = [];
      for (const item of Array.from(clipboard.items)) {
        if (item.kind !== "file") continue;
        const file = item.getAsFile();
        if (!file) continue;

        // 클립보드 이미지는 이름이 없거나 image.png 로 뭉개진다 → 시각 기반 이름 부여
        const named =
          !file.name || file.name === "image.png"
            ? new File([file], pastedFileName(file.type), { type: file.type })
            : file;
        files.push(named);
      }

      if (files.length === 0) return; // 텍스트 붙여넣기는 그대로 통과
      event.preventDefault(); // 이미지일 때만 기본 동작 차단
      add(files);
    },
    [add],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length > 0) add(files);
    },
    [add],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setDragging(true);
  }, []);

  const onDragLeave = useCallback(() => setDragging(false), []);

  const onSelect = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      add(Array.from(event.target.files ?? []));
      event.target.value = ""; // 같은 파일 다시 고를 수 있게
    },
    [add],
  );

  return {
    items,
    isDragging,
    isFull: items.length >= MAX_FILES_PER_MESSAGE,
    add,
    remove,
    clear,
    onPaste,
    onDrop,
    onDragOver,
    onDragLeave,
    onSelect,
  };
}
