"use client";

import { useState } from "react";
import type { NewTabViewInput, PersonScope, ViewFilterMap, ViewKind, ViewSort, Visibility } from "@/lib/view";
import styles from "./view.module.css";

const KIND_LABEL: Record<ViewKind, string> = { board: "보드", flat: "표", cal: "캘린더" };

/**
 * 새 뷰 만들기(D25). 사람 조건 기본값은 **보는 사람 기준**이다(D26) —
 * 「특정 사람 고정」은 예외 취급이라 목록 맨 뒤에 둔다.
 */
export function SaveViewDialog({
  orgId,
  boardKey,
  ownerId,
  kind,
  filters,
  sort,
  calendarFieldKey,
  dateColumns = [],
  people,
  onSubmit,
  onCancel,
}: {
  orgId: string;
  boardKey: string;
  ownerId: string;
  kind: ViewKind;
  filters: ViewFilterMap;
  sort?: readonly ViewSort[];
  calendarFieldKey?: string | null;
  dateColumns?: readonly { key: string; label: string }[];
  /** personScope="fixed" 선택 시 고를 사람 목록. 조직도는 이 컴포넌트 소관이 아니라 호출부가 넘긴다. */
  people?: readonly { id: string; name: string }[];
  onSubmit: (input: NewTabViewInput) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState("");
  const [personScope, setPersonScope] = useState<PersonScope>("viewer");
  const [fixedPersonId, setFixedPersonId] = useState<string>(people?.[0]?.id ?? "");
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [selectedKind, setSelectedKind] = useState<ViewKind>(kind);
  const [selectedCalendarField, setSelectedCalendarField] = useState(calendarFieldKey ?? dateColumns[0]?.key ?? "");

  const filterCount = Object.keys(filters).length;
  const canSubmit =
    name.trim().length > 0 &&
    (personScope !== "fixed" || fixedPersonId) &&
    (selectedKind !== "cal" || selectedCalendarField.length > 0);

  function submit() {
    if (!canSubmit) return;
    onSubmit({
      orgId,
      boardKey,
      ownerId,
      name: name.trim(),
      kind: selectedKind,
      visibility,
      personScope,
      personScopeUserId: personScope === "fixed" ? fixedPersonId : null,
      filters,
      sort,
      calendarFieldKey: selectedKind === "cal" ? selectedCalendarField : null,
    });
  }

  return (
    <div className={styles.dialog} role="dialog" aria-label="새 뷰 만들기">
      <h3>새 뷰 만들기</h3>
      <p className={styles.pickerHint}>
        지금 저장될 조건 — 보는 방식 <b>{KIND_LABEL[selectedKind]}</b> · 필터 <b>{filterCount}개</b>
      </p>

      <div className={styles.field}>
        <label htmlFor="view-kind">보기 방식</label>
        <select id="view-kind" value={selectedKind} onChange={(event) => setSelectedKind(event.target.value as ViewKind)}>
          <option value="flat">표</option>
          <option value="board">보드</option>
          <option value="cal" disabled={dateColumns.length === 0}>
            캘린더
          </option>
        </select>
        {selectedKind === "cal" ? (
          <select
            aria-label="캘린더 날짜 컬럼"
            value={selectedCalendarField}
            onChange={(event) => setSelectedCalendarField(event.target.value)}
          >
            {dateColumns.map((column) => (
              <option key={column.key} value={column.key}>
                {column.label}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      <div className={styles.field}>
        <label htmlFor="view-name">이름</label>
        <input id="view-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 오늘 통화할 곳" />
      </div>

      <div className={styles.field}>
        <label>사람 조건을 어떻게 둘까</label>
        <div className={styles.radioRow} role="radiogroup" aria-label="사람 조건">
          <label>
            <input type="radio" name="personScope" checked={personScope === "viewer"} onChange={() => setPersonScope("viewer")} />
            보는 사람 기준
          </label>
          <label>
            <input type="radio" name="personScope" checked={personScope === "team"} onChange={() => setPersonScope("team")} />
            내 팀 기준
          </label>
          <label>
            <input type="radio" name="personScope" checked={personScope === "none"} onChange={() => setPersonScope("none")} />
            사람 조건 없음
          </label>
          {people?.length ? (
            <label>
              <input type="radio" name="personScope" checked={personScope === "fixed"} onChange={() => setPersonScope("fixed")} />
              특정 사람 고정
            </label>
          ) : null}
        </div>
        {personScope === "fixed" && people?.length ? (
          <select value={fixedPersonId} onChange={(e) => setFixedPersonId(e.target.value)} aria-label="고정할 사람">
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        ) : null}
        <span className={styles.pickerHint}>
          <b>보는 사람 기준</b>이 기본입니다. 사람 이름을 박으면 그 사람이 바뀔 때 뷰가 거짓말을 합니다.
        </span>
      </div>

      <div className={styles.field}>
        <label>누가 볼 수 있나</label>
        <div className={styles.radioRow} role="radiogroup" aria-label="공개 범위">
          <label>
            <input type="radio" name="visibility" checked={visibility === "private"} onChange={() => setVisibility("private")} />
            나만
          </label>
          <label>
            <input type="radio" name="visibility" checked={visibility === "shared"} onChange={() => setVisibility("shared")} />
            회사 전체
          </label>
        </div>
      </div>

      <p className={styles.pickerHint}>
        <b>뷰는 권한이 아닙니다.</b> 조회 범위가 먼저 적용되고 그 위에 이 뷰의 조건이 얹힙니다.
      </p>

      <div className={styles.dialogActions}>
        {onCancel ? (
          <button type="button" onClick={onCancel}>
            취소
          </button>
        ) : null}
        <button type="button" className={styles.primary} disabled={!canSubmit} onClick={submit}>
          만들기
        </button>
      </div>
    </div>
  );
}
