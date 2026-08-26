"use client";

import { useEffect, useRef, useState } from "react";

export function VisualSettingsSlot() {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); requestAnimationFrame(() => opener.current?.focus()); } };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  return <>
    <button ref={opener} type="button" onClick={() => setOpen(true)} className="rounded border border-mw-line bg-mw-card px-3 py-2">⚙ 보드 설정</button>
    {open ? <div role="dialog" aria-label="보드 설정" className="mw-layer-dialog fixed inset-8 rounded border border-mw-line bg-mw-card p-6 shadow-lg">
      <button type="button" onClick={() => { localStorage.setItem("visual-settings-saved", "1"); setSaved(true); }}>설정 저장</button>
      <span>{saved ? "저장됨" : "저장 전"}</span>
    </div> : null}
  </>;
}
