"use client";

import { useState } from "react";
import { activateAutomation, saveAutomationDraft } from "@/lib/dynamic-workspace/workspace-ops-actions";
import type { WorkspaceOpsSnapshot } from "@/lib/dynamic-workspace/workspace-ops";
import { HIGH_CONFIDENCE_STATUS_TO_GROUP_DRAFTS, QUARANTINED_AUTOMATIONS } from "./catalogue";
import styles from "./automation-presets.module.css";

export function AutomationPresetPanel({ snapshot, approvedMessageTemplateCount = 0 }: Readonly<{ snapshot: WorkspaceOpsSnapshot; approvedMessageTemplateCount?: number }>) {
  const [boardId, setBoardId] = useState(snapshot.boards[0]?.id ?? "");
  const [automationId, setAutomationId] = useState<string | null>(snapshot.automations[0]?.id ?? null);
  const [notice, setNotice] = useState(snapshot.readError ?? "자동화를 적용할 보드를 선택해 주세요.");
  const ready = !snapshot.readError && snapshot.boards.length > 0;
  const save = async () => {
    const id = automationId ?? crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const result = await saveAutomationDraft(id, boardId, { kind: "seoul_management_basic", rules: HIGH_CONFIDENCE_STATUS_TO_GROUP_DRAFTS }, requestId);
    if (result.ok) setAutomationId(id);
    setNotice(result.message);
  };
  const activate = async () => { if (automationId) setNotice((await activateAutomation(automationId)).message); };
  return <main className={styles.page} aria-labelledby="automation-title"><header className={styles.heading}><p className={styles.eyebrow}>회사 대표 전용</p><h1 id="automation-title">업무 자동화 설정</h1><p>{notice}</p></header><section id="solapi" className={styles.notice}><div className={styles.sectionHeading}><div><h2>솔라피 메시지 발송</h2><p>신규리드의 「메시지 보내기」에서 상담 안내를 발송하는 연결입니다.</p></div><span className={styles.badge}>{approvedMessageTemplateCount > 0 ? "템플릿 준비됨" : "연결 필요"}</span></div><p>발송 워커와 중복 방지 대기열은 준비되어 있습니다. 실제 발송에는 워커의 SOLAPI_API_KEY·SOLAPI_API_SECRET과 승인 템플릿이 필요합니다.</p><strong>승인 템플릿 {approvedMessageTemplateCount}개</strong><p>키 값은 화면에 표시하거나 저장하지 않습니다. 연결 전에는 미리보기까지만 가능하고 고객에게 전송되지 않습니다.</p></section><label>자동화를 적용할 보드<select value={boardId} onChange={(event) => setBoardId(event.target.value)}>{snapshot.boards.map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}</select></label><div className={styles.sectionHeading}><button type="button" disabled={!ready} onClick={save}>기본 자동화 저장하기</button><button type="button" disabled={!automationId} onClick={activate}>자동화 사용하기</button></div><ul className={styles.list}>{HIGH_CONFIDENCE_STATUS_TO_GROUP_DRAFTS.map((draft) => <li key={draft.id} className={styles.card}><span>{draft.triggerStatus}</span><strong>{draft.targetGroup}</strong></li>)}</ul><section className={styles.quarantine}><h2>확인이 필요한 자동화</h2><p>{QUARANTINED_AUTOMATIONS.length}개 자동화는 확인하기 전까지 실행하지 않아요.</p></section></main>;
}
