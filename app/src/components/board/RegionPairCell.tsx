"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { RegionCombobox } from "./NewLeadIntakeFields";
import {
  canonicalSido,
  searchSido,
  searchSigungu,
} from "@/lib/new-lead/region-search";
import { regionPairForSidoChange, validateRegionPair } from "@/lib/new-lead/region-pair";
import {
  updateBoardRegionPairAction,
  updateNewLeadRegionPairAction,
} from "@/app/(app)/boards/region-pair-actions";

/**
 * 행 단위 공유 지역 쌍 상태 — 같은 행의 시도·시군구 두 셀이 한 요청 기준을 쓴다.
 *
 * 두 셀이 각각 pending/snapshot 을 들고 있으면 시도 저장 중에 시군구가 옛 시도로
 * 덮어쓴다(각자 persist 가 전체 쌍을 보내기 때문). 그래서 저장 기준·진행 중
 * 표시는 행 단위로 공유한다: 한 요청이 진행 중이면 다른 셀의 쓰기를 잠그고,
 * 성공하면 두 셀을 동시에 갱신하며, 실패하면 양쪽 입력을 보존한다.
 *
 * 공유 저장소는 모듈에 두고 키(행)로만 건드린다 — 컴포넌트는 훅이 돌려준 값을
 * 직접 고치지 않고 아래 함수로만 읽고 요청한다.
 */
type RegionPairSaved = { sido: string; sigungu: string };
type RegionPairRequestToken = Readonly<{ generation: number; requestId: string }>;
type RegionPairEntry = {
  saved: RegionPairSaved;
  pending: boolean;
  generation: number;
  activeRequestId: string | null;
  refs: number;
  listeners: Set<() => void>;
};

const regionPairEntries = new Map<string, RegionPairEntry>();
// Keep uncertain writes blocked even if filtering temporarily unmounts the row.
// A full reload obtains authoritative values and starts a fresh module instance.
const regionPairsRequiringReload = new Set<string>();
/** 마지막 generation을 entry 삭제 뒤에도 기억한다 — 옛 요청이 새 entry를 덮지 못하게. */
const regionPairGenerations = new Map<string, number>();
let regionPairRequestSeq = 0;

function nextRegionPairGeneration(key: string): number {
  const next = (regionPairGenerations.get(key) ?? 0) + 1;
  regionPairGenerations.set(key, next);
  return next;
}

function getOrCreateRegionPairEntry(key: string, fallback: RegionPairSaved): RegionPairEntry {
  let entry = regionPairEntries.get(key);
  if (!entry) {
    entry = {
      saved: { ...fallback },
      pending: false,
      generation: nextRegionPairGeneration(key),
      activeRequestId: null,
      refs: 0,
      listeners: new Set(),
    };
    regionPairEntries.set(key, entry);
  }
  return entry;
}

function readRegionPairEntry(key: string, fallback: RegionPairSaved): { saved: RegionPairSaved; pending: boolean; requiresReload: boolean } {
  const entry = regionPairEntries.get(key);
  const requiresReload = regionPairsRequiringReload.has(key);
  if (!entry) return { saved: { ...fallback }, pending: false, requiresReload };
  return { saved: { ...entry.saved }, pending: entry.pending, requiresReload };
}

function notifyRegionPairEntry(key: string): void {
  const entry = regionPairEntries.get(key);
  if (!entry) return;
  for (const listener of [...entry.listeners]) listener();
}

function subscribeRegionPairEntry(key: string, listener: () => void): () => void {
  const entry = getOrCreateRegionPairEntry(key, { sido: "", sigungu: "" });
  entry.refs += 1;
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
    entry.refs -= 1;
    if (entry.refs <= 0 && !entry.pending) regionPairEntries.delete(key);
  };
}

/** 공유 저장 기준을 서버 값으로 갱신 — 진행 중에는 손대지 않는다. */
function syncRegionPairSaved(key: string, sido: string, sigungu: string): void {
  const entry = regionPairEntries.get(key);
  if (!entry || entry.pending) return;
  if (entry.saved.sido === sido && entry.saved.sigungu === sigungu) return;
  entry.saved = { sido, sigungu };
  notifyRegionPairEntry(key);
}

/**
 * 다른 셀의 요청이 진행 중이면 null — 옛 기준으로 덮어쓰지 않는다.
 * 성공하면 해당 generation+request 토큰을 돌려준다.
 */
function beginRegionPairRequest(key: string): RegionPairRequestToken | null {
  const entry = regionPairEntries.get(key);
  if (!entry || entry.pending || regionPairsRequiringReload.has(key)) return null;
  entry.generation += 1;
  regionPairGenerations.set(key, entry.generation);
  regionPairRequestSeq += 1;
  const requestId = `req-${entry.generation}-${regionPairRequestSeq}-${Math.random().toString(36).slice(2)}`;
  entry.activeRequestId = requestId;
  entry.pending = true;
  notifyRegionPairEntry(key);
  return { generation: entry.generation, requestId };
}

/**
 * 정확한 generation+request에만 커밋한다.
 * 옛 요청(A)이 unmount로 지워진 뒤 같은 행에 새 요청(B)이 뜨면 A 완료가 B를
 * 덮어쓰거나 풀지 못한다 — stale entry를 되살리지도 않는다.
 */
function commitRegionPairRequest(
  key: string,
  token: RegionPairRequestToken,
  sido: string,
  sigungu: string,
): boolean {
  const entry = regionPairEntries.get(key);
  if (!entry || !entry.pending) return false;
  if (entry.generation !== token.generation || entry.activeRequestId !== token.requestId) return false;
  entry.pending = false;
  entry.activeRequestId = null;
  entry.saved = { sido, sigungu };
  notifyRegionPairEntry(key);
  return true;
}

/** 자신의 generation+request만 푼다 — 남의 요청을 풀지 않는다. */
function failRegionPairRequest(key: string, token: RegionPairRequestToken, requiresReload = false): boolean {
  const entry = regionPairEntries.get(key);
  if (!entry || !entry.pending) return false;
  if (entry.generation !== token.generation || entry.activeRequestId !== token.requestId) return false;
  entry.pending = false;
  entry.activeRequestId = null;
  if (requiresReload) regionPairsRequiringReload.add(key);
  notifyRegionPairEntry(key);
  return true;
}

/**
 * GroupTable 시도-시군구 의존 콤보 — 상세(RegionAutoSaveField)와 같은 판정·문구를 쓴다.
 *
 * - 한 셀에 한 콤보만 그린다(표 열 구조 유지). 저장은 항상 쌍으로 원자 저장한다.
 * - 시도 변경+시군구 초기화는 하나의 서버 요청으로 닫는다.
 * - 연결된 신규리드는 updateCanonicalNewLead 두 필드 patch 1회,
 *   일반보드는 실제 컬럼 키 두 값을 setCellsStrict 1회에 함께 저장한다.
 * - 단일필드 액션을 두 번 호출하지 않는다.
 * - 잘못된 쌍은 서버가 거부하고, 실패 입력은 보존해 재시도한다.
 * - 같은 행의 다른 셀이 저장 중이면 쓰기를 잠근다(공유 pending).
 */
export function RegionCell({
  boardId,
  itemId,
  dealId,
  canonicalNewLead,
  kind,
  sidoKey,
  sigunguKey,
  sidoValue,
  sigunguValue,
  readOnly,
}: {
  boardId: string;
  itemId: string;
  dealId?: string | null;
  canonicalNewLead?: boolean;
  kind: "sido" | "sigungu";
  sidoKey: string;
  sigunguKey: string;
  sidoValue: string;
  sigunguValue: string;
  readOnly: boolean;
}) {
  const pairKey = `${boardId}\n${itemId}`;
  const [, bump] = useState(0);
  useEffect(() => subscribeRegionPairEntry(pairKey, () => bump((count) => count + 1)), [pairKey]);
  // 새로고침 정합성 — 서버 값이 바뀌면 공유 저장 기준을 갱신한다.
  useEffect(() => {
    getOrCreateRegionPairEntry(pairKey, { sido: sidoValue, sigungu: sigunguValue });
    syncRegionPairSaved(pairKey, sidoValue, sigunguValue);
  }, [pairKey, sidoValue, sigunguValue]);
  const snapshot = readRegionPairEntry(pairKey, { sido: sidoValue, sigungu: sigunguValue });

  const initial = kind === "sido" ? sidoValue : sigunguValue;
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState("✓ 자동 저장됨");
  const [pending, startTransition] = useTransition();
  const baselineRef = useRef(initial);
  const valueRef = useRef(initial);

  // 공유 저장 기준 변경(다른 셀의 성공·서버 새로고침)은 두 셀에 동시에 반영한다.
  useEffect(() => {
    if (snapshot.pending || snapshot.requiresReload) return;
    const next = kind === "sido" ? snapshot.saved.sido : snapshot.saved.sigungu;
    if (baselineRef.current !== next) {
      baselineRef.current = next;
      valueRef.current = next;
      setValue(next);
      setStatus("✓ 자동 저장됨");
    }
  }, [snapshot, kind]);

  const suggestions = useMemo(
    () => (kind === "sido" ? searchSido(value) : searchSigungu(snapshot.saved.sido, value)),
    [kind, value, snapshot.saved.sido],
  );
  const busy = snapshot.pending || pending;
  const disabled = readOnly || busy || snapshot.requiresReload || (kind === "sigungu" && !canonicalSido(snapshot.saved.sido));

  async function persist(next: string) {
    const trimmed = next.trim();
    // 다른 셀의 요청이 진행 중이면 쓰지 않고 입력을 둔다 — 옛 기준으로 덮어쓰지 않는다.
    const current = readRegionPairEntry(pairKey, { sido: sidoValue, sigungu: sigunguValue });
    if (current.pending || current.requiresReload) return;
    const currentSaved = kind === "sido" ? current.saved.sido : current.saved.sigungu;
    if (trimmed === currentSaved) {
      setStatus("✓ 자동 저장됨");
      return;
    }
    // 시도 변경 때는 시군구 초기화를 같은 요청에 묶는다.
    const pair =
      kind === "sido"
        ? regionPairForSidoChange(next, current.saved.sigungu)
        : { sido: current.saved.sido, sigungu: next };
    const validated = validateRegionPair(pair);
    if (!validated.ok) {
      setStatus(validated.message);
      return;
    }
    const token = beginRegionPairRequest(pairKey);
    if (!token) return;
    setStatus("저장 중…");
    startTransition(async () => {
      try {
        const result =
          canonicalNewLead && dealId
            ? await updateNewLeadRegionPairAction({
                boardId,
                itemId,
                dealId,
                sido: pair.sido,
                sigungu: pair.sigungu,
              })
            : await updateBoardRegionPairAction({
                boardId,
                itemId,
                sidoKey,
                sigunguKey,
                sido: pair.sido,
                sigungu: pair.sigungu,
              });
        if (result.ok) {
          const committedSido = result.sido ?? "";
          const committedSigungu = result.sigungu ?? "";
          // stale이면 새 요청 상태를 건드리지 않는다(되살리지도 않는다).
          const applied = commitRegionPairRequest(pairKey, token, committedSido, committedSigungu);
          if (!applied) return;
          const committed = kind === "sido" ? committedSido : committedSigungu;
          baselineRef.current = committed;
          valueRef.current = committed;
          setValue(committed);
          setStatus(result.message);
        } else {
          // 실패 입력 보존 — 양쪽 입력을 덮어쓰지 않고 자신의 잠금만 푼다.
          failRegionPairRequest(pairKey, token, result.requiresReload);
          setStatus(result.message);
        }
      } catch (error) {
        // 응답 유실은 서버의 미저장을 보장하지 않는다. pending은 끝내되
        // 입력을 보존하고 실제 저장값을 다시 읽을 때까지 행 전체를 잠근다.
        failRegionPairRequest(pairKey, token, true);
        setStatus(
          error instanceof Error && error.message
            ? `${error.message} 저장 결과를 확인하지 못했습니다. 입력은 유지됩니다. 새로고침하여 확인해 주세요.`
            : "저장 결과를 확인하지 못했습니다. 입력은 유지됩니다. 새로고침하여 확인해 주세요.",
        );
      }
    });
  }

  function handleBlur() {
    if (readOnly || pending) return;
    const current = readRegionPairEntry(pairKey, { sido: sidoValue, sigungu: sigunguValue });
    if (current.pending || current.requiresReload) return;
    const currentSaved = kind === "sido" ? current.saved.sido : current.saved.sigungu;
    if (valueRef.current !== currentSaved) {
      void persist(valueRef.current);
    }
  }

  if (readOnly) {
    return (
      <span className="block truncate text-xs text-mw-body" title={initial || "—"}>
        {(initial || "—") as string}
      </span>
    );
  }

  const invalid = !status.startsWith("✓") && status !== "저장 중…" && status !== "입력 중…";

  return (
    <span className="flex flex-col" onBlur={handleBlur}>
      <RegionCombobox
        name={`${itemId}-${kind === "sido" ? sidoKey : sigunguKey}-region`}
        label={kind === "sido" ? "시도" : "시군구"}
        value={value}
        onValue={(next) => {
          valueRef.current = next;
          setValue(next);
          setStatus(next === baselineRef.current ? "✓ 자동 저장됨" : "입력 중…");
        }}
        suggestions={suggestions}
        disabled={disabled}
        invalid={invalid}
      />
      <span aria-live="polite" className="px-1.5 text-[0.65rem] text-mw-sub" data-saved={!snapshot.requiresReload && status.startsWith("✓")}>
        {snapshot.requiresReload ? "저장 결과를 다시 확인해야 합니다." : status}
      </span>
      {snapshot.requiresReload && <button type="button" onClick={() => window.location.reload()} className="text-xs underline">새로고침하여 확인</button>}
    </span>
  );
}
