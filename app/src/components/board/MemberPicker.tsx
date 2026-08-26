"use client";

import { useMemo, useState } from "react";

export function MemberPicker({
  label,
  members,
  value,
  multiple,
  compact = false,
}: {
  label: string;
  members: readonly { id: string; label: string }[];
  value: string | readonly string[] | null;
  multiple: boolean;
  compact?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(Array.isArray(value) ? value : typeof value === "string" ? [value] : []),
  );
  const visible = useMemo(() => members.filter((member) => member.label.toLocaleLowerCase("ko").includes(query.toLocaleLowerCase("ko"))), [members, query]);
  return (
    <details className="relative">
      {selected.size === 0 ? <input type="hidden" name="value" value="" /> : [...selected].map((id) => <input key={id} type="hidden" name="value" value={id} />)}
      <summary className={`${compact ? "min-h-7 py-1" : "min-h-9 py-2"} cursor-pointer list-none rounded border border-mw-line px-2 text-xs focus:outline-none focus:ring-2 focus:ring-mw-primary`}>
        {selected.size === 0 ? (multiple ? "선택 없음" : "미배정") : members.filter((member) => selected.has(member.id)).map((member) => member.label).join(", ")}
      </summary>
      <div className="absolute z-40 mt-1 w-56 rounded-xl border border-mw-line bg-mw-card p-2 shadow-xl">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="멤버 검색" aria-label={`${label} 멤버 검색`} className="mb-2 h-9 w-full rounded border border-mw-line bg-mw-bg px-2 py-1 text-xs" />
        <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-mw-bg">
          <input type={multiple ? "checkbox" : "radio"} checked={selected.size === 0} onChange={(event) => { if (event.target.checked) setSelected(new Set()); }} />
          <span className="grid h-6 w-6 place-items-center rounded-full bg-mw-bg text-[0.6rem]">—</span> {multiple ? "선택 없음" : "미배정"}
        </label>
        <div className="max-h-40 overflow-auto">
          {visible.map((member) => (
            <label key={member.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-mw-bg">
              <input type={multiple ? "checkbox" : "radio"} checked={selected.has(member.id)} onChange={(event) => setSelected((current) => {
                if (!multiple) return event.target.checked ? new Set([member.id]) : new Set();
                const next = new Set(current);
                if (event.target.checked) next.add(member.id); else next.delete(member.id);
                return next;
              })} />
              <span aria-hidden="true" className="grid h-6 w-6 place-items-center rounded-full bg-mw-tint-blue text-[0.6rem] font-semibold">{member.label.slice(0, 1)}</span>
              <span>{member.label}</span>
            </label>
          ))}
        </div>
        <button type="submit" className="mt-2 w-full rounded bg-mw-primary px-2 py-1 text-xs text-white">선택 저장</button>
      </div>
    </details>
  );
}
