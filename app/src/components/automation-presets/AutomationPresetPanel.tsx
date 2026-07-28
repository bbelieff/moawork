"use client";

import { useState } from "react";
import { activateAutomation, saveAutomationDraft } from "@/lib/dynamic-workspace/workspace-ops-actions";
import type { WorkspaceOpsSnapshot } from "@/lib/dynamic-workspace/workspace-ops";
import { HIGH_CONFIDENCE_STATUS_TO_GROUP_DRAFTS, QUARANTINED_AUTOMATIONS } from "./catalogue";
import styles from "./automation-presets.module.css";

export function AutomationPresetPanel({ snapshot }: Readonly<{ snapshot: WorkspaceOpsSnapshot }>) {
  const [boardId, setBoardId] = useState(snapshot.boards[0]?.id ?? "");
  const [automationId, setAutomationId] = useState<string | null>(snapshot.automations[0]?.id ?? null);
  const [notice, setNotice] = useState(snapshot.readError ?? "서버에서 불러온 보드에 초안을 저장할 수 있습니다.");
  const ready = !snapshot.readError && snapshot.boards.length > 0;
  const save = async () => {
    const id = automationId ?? crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const result = await saveAutomationDraft(id, boardId, { kind: "seoul_management_basic", rules: HIGH_CONFIDENCE_STATUS_TO_GROUP_DRAFTS }, requestId);
    if (result.ok) setAutomationId(id);
    setNotice(result.message);
  };
  const activate = async () => { if (automationId) setNotice((await activateAutomation(automationId)).message); };
  return <main className={styles.page} aria-labelledby="automation-title"><header className={styles.heading}><p className={styles.eyebrow}>Owner 전용 · 자동화 초안</p><h1 id="automation-title">업무 자동화 초안</h1><p>{notice}</p></header><label>서버 보드<select value={boardId} onChange={(event) => setBoardId(event.target.value)}>{snapshot.boards.map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}</select></label><div className={styles.sectionHeading}><button type="button" disabled={!ready} onClick={save}>서울경영 기본 구조 초안 저장</button><button type="button" disabled={!automationId} onClick={activate}>초안 활성화</button></div><ul className={styles.list}>{HIGH_CONFIDENCE_STATUS_TO_GROUP_DRAFTS.map((draft) => <li key={draft.id} className={styles.card}><span>{draft.triggerStatus}</span><strong>{draft.targetGroup}</strong></li>)}</ul><section className={styles.quarantine}><h2>격리 항목</h2><p>{QUARANTINED_AUTOMATIONS.length}개는 활성화하지 않습니다.</p></section></main>;
}
