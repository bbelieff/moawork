import { getSession } from "@/lib/auth/session";
import { loadLedger } from "@/lib/settlements/server";
import { LedgerTable } from "@/components/settlements/LedgerTable";
import { CsvExportButton } from "@/components/settlements/CsvExportButton";

export const metadata = { title: "정산·회계 — 모아워크" };

export default async function SettlementsPage() {
  const ctx = await getSession();
  const snapshot = await loadLedger(ctx);
  const canManage = ctx.role === "owner" || ctx.role === "admin";
  return <div className="space-y-5"><header className="flex flex-wrap items-end gap-3"><div><p className="text-sm font-semibold" style={{color:"var(--mw-primary)"}}>정산·회계</p><h1 className="text-2xl font-bold">입금과 미수금을 한눈에 확인해요</h1><p className="mt-1 text-sm" style={{color:"var(--mw-sub)"}}>입금·환불·정정 이력을 덮어쓰지 않고 남기며 합계를 다시 계산해요.</p></div>{canManage&&snapshot.available?<div className="ml-auto"><CsvExportButton/></div>:null}</header>{!snapshot.available?<div role="status" className="rounded-2xl border p-5" style={{borderColor:"var(--mw-line)",background:"var(--mw-card)"}}><p className="font-semibold">정산 저장소 연결을 기다리고 있어요.</p><p className="mt-1 text-sm" style={{color:"var(--mw-sub)"}}>로컬 환경에서는 금액을 표시하거나 변경하지 않아요.</p></div>:<LedgerTable rows={snapshot.rows} canManage={canManage}/>}</div>;
}
