"use client";

import { useRef, useState } from "react";
import { BoardModalLayer } from "@/components/board/BoardDialogPortal";

/** 실제 제품 모달과 같은 공통 레이어를 쓰는 비주얼 회귀 검증용 진입점. */
export function VisualLayerProbe() {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => opener.current?.focus());
  };
  return (
    <>
      <button
        ref={opener}
        type="button"
        data-testid="visual-modal-probe"
        onClick={() => setOpen(true)}
        className="fixed left-0 top-0 z-[9999] h-px w-px opacity-0"
      >
        모달 레이어 검증
      </button>
      {open ? (
        <BoardModalLayer label="모달 레이어 검증" onClose={close}>
          <div className="rounded-xl bg-mw-card p-6 shadow-xl">고정 제목행까지 덮는 공통 모달</div>
        </BoardModalLayer>
      ) : null}
    </>
  );
}
