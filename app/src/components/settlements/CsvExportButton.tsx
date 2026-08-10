"use client";
import { useState } from "react";
import { downloadLedgerCsv } from "@/app/(app)/settlements/actions";

export function CsvExportButton() {
  const [pending,setPending]=useState(false);
  return <button disabled={pending} className="rounded-xl border px-4 py-2 text-sm font-semibold" style={{borderColor:"var(--mw-line)",background:"var(--mw-card)"}} onClick={async()=>{setPending(true);try{const csv=await downloadLedgerCsv();const blob=new Blob(["\uFEFF",csv],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`settlements-${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(url);}finally{setPending(false);}}}>{pending?"준비 중…":"CSV 내보내기"}</button>;
}
