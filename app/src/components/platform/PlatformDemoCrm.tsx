import { StageBoardView } from "@/components/crm/StageBoardView";
import type { StageBoardData } from "@/lib/crm/boardData";
import styles from "./platform-demo.module.css";

export function PlatformDemoCrm({ data }: Readonly<{
  data: StageBoardData;
}>) {
  return <section className={styles.crm} aria-label="데모 CRM">
    <div className={styles.crmBoard}><StageBoardView data={data} linksEnabled={false} onboardingCta={false} emptyHint="CSV 가져오기를 누르면 첫 단계와 항목이 데모 CRM에 바로 저장돼요." /></div>
  </section>;
}
