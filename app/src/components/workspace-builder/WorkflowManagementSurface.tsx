"use client";

import Link from "next/link";
import { startTransition, useMemo, useState } from "react";
import {
  renameWorkflowGroupAction,
  reorderWorkflowGroupsAction,
  type WorkflowStructureResult,
} from "@/app/(app)/settings/workspace-builder/actions";
import styles from "./builder-workspace.module.css";

export type WorkflowManagementTab = Readonly<{
  key: "new-lead" | "contact" | "work" | "companies";
  order: number;
  name: string;
  description: string;
  href: string;
  boardId: string | null;
  groups: ReadonlyArray<{ id: string; name: string; color: string | null }>;
  transition: string;
  transitionKind: "move" | "projection" | "complete";
}>;

const EMPTY_NOTICE: WorkflowStructureResult = {
  ok: true,
  message: "단계 이름과 순서는 실제 업무 탭에 바로 적용됩니다.",
};

export function moveAt<T>(values: readonly T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (index < 0 || index >= values.length || target < 0 || target >= values.length) return [...values];
  const next = [...values];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
}

function StageEditor({ tab }: Readonly<{ tab: WorkflowManagementTab }>) {
  const [groups, setGroups] = useState([...tab.groups]);
  const [notice, setNotice] = useState<WorkflowStructureResult>(EMPTY_NOTICE);
  const [pendingId, setPendingId] = useState<string | null>(null);

  function move(index: number, delta: number) {
    if (!tab.boardId) return;
    const next = moveAt(groups, index, delta);
    if (next.every((group, position) => group.id === groups[position]?.id)) return;
    setGroups(next);
    setPendingId("order");
    startTransition(async () => {
      const result = await reorderWorkflowGroupsAction(tab.boardId!, next.map((group) => group.id));
      setNotice(result);
      if (!result.ok) setGroups([...tab.groups]);
      setPendingId(null);
    });
  }

  return (
    <section className={styles.workflowEditor} aria-labelledby={`workflow-${tab.key}`}>
      <div className={styles.panelHeading}>
        <div>
          <p className={styles.eyebrow}>업무 탭 {tab.order}</p>
          <h3 id={`workflow-${tab.key}`}>{tab.name}</h3>
        </div>
        <Link href={tab.href} className={styles.secondary}>실제 탭 열기 ↗</Link>
      </div>
      {tab.boardId ? (
        <ol className={styles.stageList}>
          {groups.map((group, index) => (
            <li key={group.id} className={styles.stageRow}>
              <span className={styles.stageIndex}>{index + 1}</span>
              <span className={styles.stageColor} style={{ background: group.color ?? "var(--mw-line)" }} aria-hidden="true" />
              <form
                className={styles.stageNameForm}
                onSubmit={(event) => {
                  event.preventDefault();
                  const name = new FormData(event.currentTarget).get("name")?.toString() ?? "";
                  setPendingId(group.id);
                  startTransition(async () => {
                    const result = await renameWorkflowGroupAction(tab.boardId!, group.id, name);
                    setNotice(result);
                    if (result.ok) setGroups((current) => current.map((entry) => entry.id === group.id ? { ...entry, name: name.trim() } : entry));
                    setPendingId(null);
                  });
                }}
              >
                <label className="sr-only" htmlFor={`stage-${group.id}`}>{group.name} 단계 이름</label>
                <input id={`stage-${group.id}`} name="name" defaultValue={group.name} maxLength={100} required />
                <button type="submit" className={styles.secondary} disabled={pendingId === group.id}>저장</button>
              </form>
              <div className={styles.orderButtons} aria-label={`${group.name} 순서 변경`}>
                <button type="button" onClick={() => move(index, -1)} disabled={index === 0 || pendingId === "order"} aria-label={`${group.name} 위로`}>↑</button>
                <button type="button" onClick={() => move(index, 1)} disabled={index === groups.length - 1 || pendingId === "order"} aria-label={`${group.name} 아래로`}>↓</button>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.projectionNote}>{tab.key === "companies" ? "이 단계는 별도 보드가 아니라 계약업체 실무의 결과를 모아 보여주는 현황 화면입니다." : "이 회사에는 해당 기본 업무 보드가 아직 없습니다. 탭을 준비한 뒤 단계 편집이 활성화됩니다."}</p>
      )}
      <p className={notice.ok ? styles.notice : styles.noticeError} role={notice.ok ? "status" : "alert"}>{notice.message}</p>
    </section>
  );
}

export function WorkflowManagementSurface({ tabs }: Readonly<{ tabs: readonly WorkflowManagementTab[] }>) {
  const [view, setView] = useState<"overview" | "stages">("overview");
  const ordered = useMemo(() => [...tabs].sort((left, right) => left.order - right.order), [tabs]);
  const connectedCount = tabs.filter((tab) => tab.boardId).length;

  return (
    <section className={styles.surface} aria-labelledby="workflow-management-title">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>회사 대표 전용 · 실제 업무 구조</p>
          <h1 id="workflow-management-title">워크플로 관리</h1>
          <p className={styles.description}>4개 업무 탭의 순서, 탭 안 단계, 다음 업무로 넘기는 동작을 한 화면에서 확인합니다.</p>
        </div>
        <span className={styles.status}>연결된 업무 보드 {connectedCount}/3</span>
      </header>

      <div className={styles.viewTabs} role="tablist" aria-label="워크플로 보기">
        <button type="button" role="tab" aria-selected={view === "overview"} className={view === "overview" ? styles.activeViewTab : styles.viewTab} onClick={() => setView("overview")}>전체 구조</button>
        <button type="button" role="tab" aria-selected={view === "stages"} className={view === "stages" ? styles.activeViewTab : styles.viewTab} onClick={() => setView("stages")}>단계 편집</button>
      </div>

      {view === "overview" ? (
        <div className={styles.workflowCanvas} role="tabpanel">
          <div className={styles.workflowLegend}>
            <span><i className={styles.legendStage} /> 보드 안 단계 · 값만 변경</span>
            <span><i className={styles.legendMove} /> 탭 이동 · 확인 후 실제 이동</span>
            <span><i className={styles.legendProjection} /> 자동 반영 · 현황 화면</span>
          </div>
          <ol className={styles.workflowRail}>
            {ordered.map((tab, index) => (
              <li key={tab.key} className={styles.workflowStep}>
                <article className={styles.workflowCard}>
                  <div className={styles.workflowCardHead}>
                    <span className={styles.stepNumber}>{tab.order}</span>
                    <div><h2>{tab.name}</h2><p>{tab.description}</p></div>
                  </div>
                  <div className={styles.groupChips}>
                    {tab.groups.length > 0
                      ? tab.groups.map((group) => <span key={group.id}>{group.name}</span>)
                      : <span>{tab.key === "companies" ? "최종 회사 현황" : "업무 보드 준비 필요"}</span>}
                  </div>
                  <Link href={tab.href} className={styles.openTab}>실제 탭 열기 ↗</Link>
                </article>
                {index < ordered.length - 1 ? (
                  <div className={`${styles.transition} ${tab.transitionKind === "projection" ? styles.transitionProjection : ""}`}>
                    <span>{tab.transitionKind === "move" ? "실제 이동" : "자동 반영"}</span>
                    <strong>{tab.transition}</strong>
                    <b aria-hidden="true">→</b>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
          <aside className={styles.futureScope}>
            <strong>다음 확장 지점</strong>
            <p>탭 추가·숨김·삭제·분류·전체 순서 변경은 실제 사이드바와 이동 규칙까지 함께 바꾸는 기능입니다. 이번 기반 위에 사용자가 정할 분류 체계를 붙입니다.</p>
          </aside>
        </div>
      ) : (
        <div className={styles.editorGrid} role="tabpanel">
          <header className={styles.editorIntro}>
            <h2>탭 안 단계</h2>
            <p>여기서 바꾼 이름과 순서는 즉시 실제 보드 그룹에 저장됩니다. `진행현황`의 보드 안 단계도 같은 순서를 따릅니다.</p>
          </header>
          {ordered.map((tab) => <StageEditor key={tab.key} tab={tab} />)}
        </div>
      )}
    </section>
  );
}
