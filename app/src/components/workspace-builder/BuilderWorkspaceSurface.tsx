"use client";

import { useMemo, useState } from "react";
import styles from "./builder-workspace.module.css";
import type { CsvImportScope } from "@/lib/dynamic-workspace/csv-import";
import type { FunctionalMvpAvailability } from "@/lib/dynamic-workspace/server-contract";

type SourceMode = "same_source_view" | "independent" | "relational";
type Matrix = { id: string; label: string; sourceMode: SourceMode };
type BuilderTab = { id: string; label: string; boardLabel: string; matrices: Matrix[] };
type CsvPreview = { rows: number; quarantined: number } | null;

const SOURCE_LABEL: Record<SourceMode, string> = {
  same_source_view: "같은 원본 보기",
  independent: "독립 원본",
  relational: "관계형 원본",
};

export function parseDeidentifiedCsvPreview(text: string): CsvPreview {
  const rows = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (rows.length < 2) return { rows: 0, quarantined: 0 };
  const width = rows[0].split(",").length;
  const invalid = rows.slice(1).filter((row) => row.split(",").length !== width).length;
  return { rows: rows.length - 1 - invalid, quarantined: invalid };
}

export function BuilderWorkspaceSurface({ availability, csvScope }: Readonly<{ availability: FunctionalMvpAvailability; csvScope: CsvImportScope }>) {
  const [tabs, setTabs] = useState<BuilderTab[]>([]);
  const [draftTab, setDraftTab] = useState("");
  const [draftBoard, setDraftBoard] = useState("");
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [sourceMode, setSourceMode] = useState<SourceMode>("same_source_view");
  const [csvText, setCsvText] = useState("");
  const [preset, setPreset] = useState<"none" | "seoul_management_basic">("none");
  const preview = useMemo(() => parseDeidentifiedCsvPreview(csvText), [csvText]);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;

  const addTab = () => {
    const label = draftTab.trim();
    const boardLabel = draftBoard.trim();
    if (!label || !boardLabel) return;
    const tab: BuilderTab = { id: crypto.randomUUID(), label, boardLabel, matrices: [] };
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
    setDraftTab("");
    setDraftBoard("");
  };

  const addMatrix = () => {
    if (!activeTab) return;
    setTabs((current) => current.map((tab) => tab.id === activeTab.id
      ? { ...tab, matrices: [...tab.matrices, { id: crypto.randomUUID(), label: `Matrix ${tab.matrices.length + 1}`, sourceMode }] }
      : tab));
  };

  return (
    <section className={styles.surface} aria-labelledby="builder-title">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Workspace 설정 · Owner 전용</p>
          <h1 id="builder-title">우리 팀 업무 구조 만들기</h1>
          <p className={styles.description}>탭에서 보드와 여러 Matrix를 차례로 설계하세요. 지금은 안전한 초안·미리보기만 제공합니다.</p>
        </div>
        <span className={styles.status} aria-label="저장 상태">{availability.kind === "ready" ? "서버 초안 확인됨" : "초안 · 서버 저장 전"}</span>
      </header>

      <div className={styles.layout}>
        <aside className={styles.sidebar} aria-label="업무 탭">
          <strong>탭</strong>
          <div className={styles.tabList}>
            {tabs.length === 0 ? <p className={styles.empty}>아직 탭이 없습니다.</p> : tabs.map((tab) => (
              <button key={tab.id} type="button" className={tab.id === activeTabId ? styles.activeTab : styles.tab} onClick={() => setActiveTabId(tab.id)}>
                <span>{tab.label}</span><small>{tab.matrices.length} Matrix</small>
              </button>
            ))}
          </div>
          <label>탭 이름<input value={draftTab} onChange={(event) => setDraftTab(event.target.value)} placeholder="예: 영업 관리" /></label>
          <label>연결할 보드<input value={draftBoard} onChange={(event) => setDraftBoard(event.target.value)} placeholder="예: 고객·업무 보드" /></label>
          <button type="button" className={styles.primary} onClick={addTab} disabled={!draftTab.trim() || !draftBoard.trim()}>탭과 보드 추가</button>
        </aside>

        <div className={styles.content}>
          <section className={styles.panel} aria-live="polite">
            {availability.kind !== "ready" ? <p className={styles.notice}>{availability.message}</p> : null}
            <div className={styles.panelHeading}><div><p className={styles.eyebrow}>1. 보드와 Matrix</p><h2>{activeTab ? `${activeTab.label} · ${activeTab.boardLabel}` : "탭을 먼저 추가해 주세요"}</h2></div></div>
            {activeTab ? <>
              <div className={styles.matrixToolbar}><label>원본 연결<select value={sourceMode} onChange={(event) => setSourceMode(event.target.value as SourceMode)}>{Object.entries(SOURCE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button type="button" className={styles.secondary} onClick={addMatrix}>Matrix 추가</button></div>
              <div className={styles.matrixGrid}>{activeTab.matrices.length === 0 ? <p className={styles.empty}>첫 Matrix를 추가하면 여기에서 보기를 구성할 수 있습니다.</p> : activeTab.matrices.map((matrix) => <article className={styles.matrix} key={matrix.id}><strong>{matrix.label}</strong><span>{SOURCE_LABEL[matrix.sourceMode]}</span><small>원본 연결은 저장 전입니다.</small></article>)}</div>
            </> : null}
          </section>

          <section className={styles.panel}>
            <p className={styles.eyebrow}>2. 기존 구조 가져오기</p><h2>CSV dry-run과 기본 구조</h2>
            <div className={styles.importGrid}><label>붙여넣을 CSV<textarea value={csvText} onChange={(event) => setCsvText(event.target.value)} placeholder="개인정보를 제외한 CSV를 붙여넣으세요." /></label><div className={styles.preview}><strong>Dry-run 미리보기</strong><p>{preview ? `적용 후보 ${preview.rows}행 · 격리 ${preview.quarantined}행` : "CSV를 붙여넣으면 행 수와 형식 오류만 미리 확인합니다."}</p><small>서버 CSV scope: {csvScope.mappingVersion} · hosted 010 적용 전에는 저장·적용할 수 없습니다.</small></div></div>
            <label className={styles.preset}>기본 구조<select value={preset} onChange={(event) => setPreset(event.target.value as "none" | "seoul_management_basic")}><option value="none">선택 안 함</option><option value="seoul_management_basic">서울경영 기본 구조 (식별정보 없는 프리셋)</option></select></label>
          </section>

          <section className={styles.panel}>
            <p className={styles.eyebrow}>3. 미리보기와 게시</p><h2>서버 연결 전에는 적용하지 않습니다</h2>
            <p className={styles.description}>현재 초안: 탭 {tabs.length}개 · 선택 프리셋 {preset === "none" ? "없음" : "서울경영 기본 구조"}</p>
            <div className={styles.actions}><button type="button" className={styles.secondary}>초안 미리보기</button><button type="button" className={styles.disabled} disabled title="서버 영속화와 Owner 적용 권한이 연결되기 전에는 적용할 수 없습니다.">적용 준비 중</button><button type="button" className={styles.disabled} disabled>되돌리기 준비 중</button></div>
            <p className={styles.notice}>적용과 되돌리기는 서버 영속화·Owner 권한 검증·감사 기록이 연결된 뒤에만 활성화됩니다.</p>
          </section>
        </div>
      </div>
    </section>
  );
}
