"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./member-picker.module.css";

export type MemberPickerMember = Readonly<{
  id: string;
  label: string;
  title?: string | null;
  groupId?: string | null;
  groupLabel?: string | null;
  active?: boolean;
}>;

type Position = { left: number; top: number; width: number; maxHeight: number };

function ids(value: string | readonly string[] | null): Set<string> {
  return new Set(Array.isArray(value) ? value : typeof value === "string" && value ? [value] : []);
}

function initials(label: string): string {
  return label.trim().slice(0, 1) || "멤";
}

export function MemberPicker({
  label,
  members,
  value,
  multiple,
  compact = false,
  labelId,
  triggerLabel,
  ruleRecipients = [],
}: {
  label: string;
  members: readonly MemberPickerMember[];
  value: string | readonly string[] | null;
  multiple: boolean;
  compact?: boolean;
  labelId?: string;
  triggerLabel?: string;
  /** 담당자처럼 규칙상 알림을 받되 직접 선택값에는 섞이지 않는 사람. */
  ruleRecipients?: readonly MemberPickerMember[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Set<string>>(() => ids(value));
  const [selectionOverride, setSelectionOverride] = useState<{ source: string; selected: Set<string> } | null>(null);
  const [position, setPosition] = useState<Position>({ left: 8, top: 8, width: multiple ? 440 : 352, maxHeight: 560 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const valueSignature = typeof value === "string" ? value : value ? [...value].sort().join("\u0000") : "";
  const canonicalSelection = useMemo(
    () => new Set(valueSignature ? valueSignature.split("\u0000") : []),
    [valueSignature],
  );
  const committed = selectionOverride?.source === valueSignature
    ? selectionOverride.selected
    : canonicalSelection;

  const activeMembers = useMemo(
    () => members.filter((member) => member.active !== false),
    [members],
  );
  const byId = useMemo(() => new Map(activeMembers.map((member) => [member.id, member])), [activeMembers]);
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ko");
    if (!needle) return activeMembers;
    return activeMembers.filter((member) =>
      [member.label, member.title, member.groupLabel]
        .filter(Boolean)
        .some((part) => String(part).toLocaleLowerCase("ko").includes(needle)),
    );
  }, [activeMembers, query]);
  const groups = useMemo(() => {
    const map = new Map<string, { id: string; label: string; members: MemberPickerMember[] }>();
    for (const member of visible) {
      const id = member.groupId || "unassigned";
      const current = map.get(id) ?? { id, label: member.groupLabel || "부서 미지정", members: [] };
      current.members.push(member);
      map.set(id, current);
    }
    return [...map.values()];
  }, [visible]);

  const place = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const inset = 8;
    const desiredWidth = multiple ? 440 : 352;
    const width = Math.min(desiredWidth, window.innerWidth - inset * 2);
    const maxHeight = Math.max(260, Math.min(560, window.innerHeight - inset * 2));
    const left = Math.max(inset, Math.min(rect.left, window.innerWidth - width - inset));
    const estimatedHeight = Math.min(maxHeight, multiple ? 520 : 420);
    const below = rect.bottom + 6;
    const top = below + estimatedHeight <= window.innerHeight - inset
      ? below
      : Math.max(inset, rect.top - estimatedHeight - 6);
    setPosition({ left, top, width, maxHeight });
  }, [multiple]);

  function openPicker() {
    setDraft(new Set(committed));
    setQuery("");
    setOpen(true);
    window.requestAnimationFrame(() => {
      place();
      searchRef.current?.focus();
    });
  }

  const closePicker = useCallback((restoreFocus = true) => {
    setOpen(false);
    setDraft(new Set(committed));
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, [committed]);

  function saveSelection() {
    setSelectionOverride({ source: valueSignature, selected: new Set(draft) });
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.closest("form")?.requestSubmit());
  }

  useEffect(() => {
    if (!open) return;
    const reposition = () => place();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      closePicker(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closePicker();
    };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [closePicker, open, place]);

  const committedMembers = [...committed].map((id) => byId.get(id)).filter((member): member is MemberPickerMember => Boolean(member));
  const summary = committedMembers.length === 0
    ? (multiple ? "선택 없음" : "미배정")
    : multiple
      ? committedMembers.length <= 2
        ? committedMembers.map((member) => member.label).join(", ")
        : `${committedMembers[0].label} 외 ${committedMembers.length - 1}명`
      : committedMembers[0].label;

  const popover = open ? (
    <div
      ref={popoverRef}
      role="dialog"
      aria-modal="false"
      aria-label={`${label} 선택`}
      className={styles.popover}
      style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight }}
    >
      <header className={styles.header}>
        <div>
          <strong>{multiple ? "연관담당 선택" : "담당자 선택"}</strong>
          <span>{multiple ? "이 회사의 변경 알림을 함께 받을 사람을 고릅니다." : "이 회사를 책임질 담당자 한 명을 고릅니다."}</span>
        </div>
        <button type="button" onClick={() => closePicker()} aria-label={`${label} 선택 닫기`}>×</button>
      </header>

      {multiple && ruleRecipients.length > 0 ? (
        <section className={styles.ruleSection} aria-label="규칙에 따라 받는 사람">
          <div className={styles.sectionTitle}>
            <b>규칙에 따라 받는 사람</b>
            <span aria-hidden="true">🔒</span>
          </div>
          <div className={styles.chips}>
            {ruleRecipients.map((member) => (
              <span key={member.id} className={styles.personChip}>
                <span>{initials(member.label)}</span>{member.label}<small>담당자</small>
              </span>
            ))}
          </div>
        </section>
      ) : null}

      <section className={styles.selectionSection} aria-label={multiple ? "이 회사에만 추가된 대상" : "담당자 후보"}>
        <div className={styles.sectionTitle}>
          <b>{multiple ? "이 회사에만 추가된 대상" : "담당자 후보"}</b>
          {multiple ? <span>{draft.size}명 선택</span> : null}
        </div>
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="이름·부서 검색"
          aria-label={`${label} 멤버 검색`}
          className={styles.search}
        />
        <div className={styles.list} role="listbox" aria-multiselectable={multiple || undefined}>
          <label className={styles.memberRow}>
            <input
              type={multiple ? "checkbox" : "radio"}
              checked={draft.size === 0}
              onChange={(event) => { if (event.target.checked) setDraft(new Set()); }}
            />
            <span className={styles.emptyAvatar}>—</span>
            <span><b>{multiple ? "직접 추가 없음" : "미배정"}</b><small>{multiple ? "담당자만 규칙으로 알림을 받습니다." : "담당자를 지정하지 않습니다."}</small></span>
          </label>
          {groups.map((group) => {
            const groupIds = group.members.map((member) => member.id);
            const allSelected = multiple && groupIds.length > 0 && groupIds.every((id) => draft.has(id));
            return (
              <section key={group.id} className={styles.group} aria-label={group.label}>
                <label className={styles.groupRow}>
                  {multiple ? (
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={(event) => setDraft((current) => {
                        const next = new Set(current);
                        for (const id of groupIds) {
                          if (event.target.checked) next.add(id);
                          else next.delete(id);
                        }
                        return next;
                      })}
                    />
                  ) : <span aria-hidden="true" className={styles.groupIcon}>⌘</span>}
                  <b>{group.label}</b><small>{group.members.length}명</small>
                </label>
                {group.members.map((member) => (
                  <label key={member.id} className={styles.memberRow}>
                    <input
                      type={multiple ? "checkbox" : "radio"}
                      checked={draft.has(member.id)}
                      onChange={(event) => setDraft((current) => {
                        if (!multiple) return event.target.checked ? new Set([member.id]) : new Set();
                        const next = new Set(current);
                        if (event.target.checked) next.add(member.id);
                        else next.delete(member.id);
                        return next;
                      })}
                    />
                    <span className={styles.avatar}>{initials(member.label)}</span>
                    <span><b>{member.label}</b><small>{member.title || group.label}</small></span>
                  </label>
                ))}
              </section>
            );
          })}
          {visible.length === 0 ? <p className={styles.empty}>검색 결과가 없습니다.</p> : null}
        </div>
      </section>
      {multiple ? <p className={styles.note}>부서를 고르면 현재 소속 구성원이 함께 선택됩니다. 이후 조직 변경은 조직도 연동이 완료되면 자동 반영됩니다.</p> : null}
      <footer className={styles.footer}>
        <button type="button" onClick={() => closePicker()}>취소</button>
        <button type="button" className={styles.save} onClick={saveSelection}>선택 저장</button>
      </footer>
    </div>
  ) : null;

  return (
    <>
      {committed.size === 0 ? <input type="hidden" name="value" value="" /> : [...committed].map((id) => <input key={id} type="hidden" name="value" value={id} />)}
      <button
        ref={triggerRef}
        type="button"
        aria-labelledby={labelId}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => open ? closePicker() : openPicker()}
        className={`${styles.trigger} ${compact ? styles.compact : ""} ${triggerLabel ? styles.actionTrigger : ""}`}
      >
        {triggerLabel ?? summary}
      </button>
      {typeof document !== "undefined" && popover ? createPortal(popover, document.body) : popover}
    </>
  );
}
