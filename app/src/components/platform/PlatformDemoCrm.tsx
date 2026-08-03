import Link from "next/link";
import { StageBoardView } from "@/components/crm/StageBoardView";
import { CsvImportDialog } from "@/components/workspace-builder/CsvImportDialog";
import type { StageBoardData } from "@/lib/crm/boardData";
import { STAGE_BOARDS } from "@/lib/crm/stageBoards";
import type { WorkspaceOpsAction } from "@/lib/dynamic-workspace/workspace-ops-actions";
import type { CsvRow } from "@/components/workspace-builder/CsvImportDialog";
import styles from "./platform-demo.module.css";

export function PlatformDemoCrm({ data, importCsv }: Readonly<{
  data: StageBoardData;
  importCsv: (boardSlug: string, rows: readonly CsvRow[]) => Promise<WorkspaceOpsAction>;
}>) {
  return <section className={styles.crm} aria-label="데모 CRM">
    <header className={styles.crmHeader}>
      <div><p className={styles.kicker}>현재 배포된 기능</p><h2>데모 CRM</h2><p>실제 저장되는 샌드박스에서 고객과 업무 흐름을 확인하세요.</p></div>
      <CsvImportDialog activeBoard={data.board.slug} importCsv={importCsv} />
    </header>
    <nav className={styles.crmTabs} aria-label="CRM 보드">
      {STAGE_BOARDS.map((board) => <Link key={board.slug} href={`/platform/demo?crm=${board.slug}`} aria-current={data.board.slug === board.slug ? "page" : undefined}>{board.title}</Link>)}
    </nav>
    <div className={styles.crmBoard}><StageBoardView data={data} /></div>
  </section>;
}
