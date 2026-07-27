import {
  AUTOMATION_ACTIVATION_BLOCK_MESSAGE,
  HIGH_CONFIDENCE_STATUS_TO_GROUP_DRAFTS,
  QUARANTINED_AUTOMATIONS,
} from "./catalogue";
import styles from "./automation-presets.module.css";
import type { FunctionalMvpAvailability } from "@/lib/dynamic-workspace/server-contract";

export function AutomationPresetPanel({ availability }: Readonly<{ availability: FunctionalMvpAvailability }>) {
  return (
    <main className={styles.page} aria-labelledby="automation-title">
      <header className={styles.heading}>
        <p className={styles.eyebrow}>대표 전용 · 내부 납품 초안</p>
        <h1 id="automation-title">업무 흐름 초안</h1>
        <p>상태가 바뀌면 그룹을 옮기는 반복 흐름을 먼저 검토해요. 아직 실행되거나 저장되지는 않아요.</p>
      </header>

      <section className={styles.notice} aria-label="활성화 안내">
        <strong>지금은 켤 수 없어요</strong>
        <span>{availability.kind === "ready" ? AUTOMATION_ACTIVATION_BLOCK_MESSAGE : availability.message}</span>
      </section>

      <section aria-labelledby="draft-title">
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="draft-title">검토 가능한 초안</h2>
            <p>신뢰도 높은 상태 → 그룹 이동 {HIGH_CONFIDENCE_STATUS_TO_GROUP_DRAFTS.length}개</p>
          </div>
          <span className={styles.badge}>초안 · 비활성</span>
        </div>
        <ul className={styles.list} aria-label="상태에서 그룹으로 이동하는 초안 목록">
          {HIGH_CONFIDENCE_STATUS_TO_GROUP_DRAFTS.map((draft) => (
            <li key={draft.id} className={styles.card}>
              <span className={styles.status}>{draft.triggerStatus}</span>
              <span aria-hidden="true" className={styles.arrow}>→</span>
              <strong>{draft.targetGroup}</strong>
              <button disabled aria-describedby="activation-explainer">활성화 준비 중</button>
            </li>
          ))}
        </ul>
        <p id="activation-explainer" className={styles.srOnly}>{AUTOMATION_ACTIVATION_BLOCK_MESSAGE}</p>
      </section>

      <section className={styles.quarantine} aria-labelledby="quarantine-title">
        <h2 id="quarantine-title">격리한 항목</h2>
        <p>외부 동작, 원본 규칙 누락, 의존성 불명확 항목 {QUARANTINED_AUTOMATIONS.length}개는 실행하지 않고 보관해요.</p>
        <ul>
          {QUARANTINED_AUTOMATIONS.map((item) => <li key={item.id}>지원 범위 확인 전 보류</li>)}
        </ul>
      </section>
    </main>
  );
}
