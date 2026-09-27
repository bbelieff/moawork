"use client";

import { useState } from "react";
import { DocumentOcrModal } from "@/components/document-ocr/DocumentOcrModal";
import { OCR_FIELD_KEYS } from "@/lib/document-ocr/types";

/** Browser engine/layout fixture. It never writes a company or customer record. */
export function VisualDocumentOcrProbe() {
  const [open, setOpen] = useState(false);
  const [applied, setApplied] = useState(0);
  return (
    <main className="min-h-screen bg-mw-bg p-4" data-visual-ocr-fixture>
      <h1>서류 인식 화면 검사</h1>
      <p>합성 서류 전용 · 저장은 이 화면의 임시 결과만 바꿉니다.</p>
      <button onClick={() => setOpen(true)}>서류 인식 열기</button>
      <output aria-label="임시 반영 결과">{applied}개</output>
      {open && <DocumentOcrModal
        open
        current={{ companyName: "가상 회사", representative: "가상 대표" }}
        fieldMap={Object.fromEntries(OCR_FIELD_KEYS.map((key) => [key, key]))}
        onClose={() => setOpen(false)}
        onApply={async ({ selections }) => {
          setApplied(selections.length);
          return { ok: true, fieldErrors: {}, message: "화면 검사 임시 반영 완료" };
        }}
      />}
    </main>
  );
}
