"use client";

/**
 * 그룹 머리말의 아이템 프리셋 메뉴 (BBE-174) — 목업 v6 `gmenu()` 의 프리셋 항목.
 *
 * 예전에는 이 자리에 「저장·적용은 WO-6에서 연결됩니다」라는 안내 문구를 단 `<span>` 하나가
 * 있었다. 부품은 다 있는데 부르는 곳이 없어서 그랬다(AGENTS.md §1.3). 이 컴포넌트가 그
 * **소비자**다 — 저장 · 미리보기 · 적용 · 되돌리기를 실제로 실행한다.
 *
 * 설계상 지키는 것 셋:
 *
 * ① **미리보기 없이 적용하지 않는다.** 프리셋을 고르면 «무엇이 추가되고 무엇이 그대로
 *    남는지» 를 먼저 보여 주고, 그 화면에서만 적용 버튼이 나온다. 계산은 서버 액션이
 *    쓰는 것과 **같은 순수 함수**(`previewGroupPresetApply`)라 미리보기와 결과가 갈라지지
 *    않는다. 서버는 화면이 보낸 계산 결과를 받지 않고 자기가 다시 계산한다.
 *
 * ② **권한이 없으면 버튼을 감추지 않고 이유를 적는다.** 사라진 버튼은 사용자가 «고장» 으로
 *    읽는다. 서버 액션도 독립적으로 다시 막으므로 여기 표시는 안내이지 방어선이 아니다.
 *
 * ② **요청 id 는 폼이 열릴 때 한 번만 만든다.** 저장 버튼을 두 번 눌러도 같은 id 가 가서
 *    프리셋이 하나만 생긴다(`groupPresetRequestSource`). 제출할 때마다 새로 만들면
 *    멱등성이 그 자리에서 무너진다.
 *
 * 팝오버는 `<details>` 로 만든다 — 열림 상태를 브라우저가 들고, 키보드 접근과 Esc 가
 * 공짜로 따라온다. 375px 에서는 화면 밖으로 나가지 않도록 오른쪽에 붙여 폭을 제한한다.
 */

import { useActionState, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { BoardColumn } from "@/lib/boards/types";
import type { SectionPresetRecord } from "@/lib/presets/section-presets";
import { previewGroupPresetApply } from "@/lib/presets/group-preset";
import { noticeLive, noticeRole } from "@/lib/ui/result-notice";
import {
  loadGroupPresetLibraryAction,
  applyGroupPresetAction,
  resetGroupPresetAction,
  saveGroupPresetAction,
  type GroupPresetLibraryState,
} from "@/app/(app)/boards/preset-actions";
import { INITIAL_GROUP_PRESET_STATE } from "@/app/(app)/boards/group-preset-state";

interface GroupPresetMenuProps {
  boardId: string;
  /** 그룹 키 — board_groups.id, 또는 가상 «그룹 없음» 블록의 예약어. */
  groupKey: string;
  /** 이 그룹이 실제 board_groups 행인가. 가상 블록은 저장 대상이 없다. */
  savable: boolean;
  /** 칩에 보이는 `탭-그룹` 이름 = 저장 기본값. */
  presetName: string;
  /** 이 그룹에서 지금 보이는 순서의 컬럼(= 적용 대상). */
  columns: readonly BoardColumn[];
  /** 이 그룹의 배치 오버라이드(현재 저장분). */
  order: readonly string[] | undefined;
  canEditPresets: boolean;
  canManageColumns: boolean;
}

export function createPresetLibraryLoader(
  load: () => Promise<GroupPresetLibraryState>,
): { open: () => Promise<GroupPresetLibraryState> } {
  let request: Promise<GroupPresetLibraryState> | null = null;
  return { open: () => (request ??= load()) };
}

export function GroupPresetMenu({
  boardId,
  groupKey,
  savable,
  presetName,
  columns,
  order,
  canEditPresets,
  canManageColumns,
}: GroupPresetMenuProps) {
  const router = useRouter();
  const panelId = useId();
  // ③ 폼 수명 동안 고정되는 요청 id — 재제출이 두 번째 프리셋을 만들지 않게 한다.
  const [requestId] = useState(() => crypto.randomUUID());
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [presets, setPresets] = useState<readonly SectionPresetRecord[]>([]);
  const [libraryState, setLibraryState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [libraryMessage, setLibraryMessage] = useState<string | null>(null);
  const loader = useRef(createPresetLibraryLoader(() => loadGroupPresetLibraryAction(boardId)));

  const [saveState, save, saving] = useActionState(saveGroupPresetAction, INITIAL_GROUP_PRESET_STATE);
  const [applyState, apply, applying] = useActionState(applyGroupPresetAction, INITIAL_GROUP_PRESET_STATE);
  const [resetState, reset, resetting] = useActionState(resetGroupPresetAction, INITIAL_GROUP_PRESET_STATE);

  const selected = presets.find((preset) => preset.id === selectedPresetId);
  // ① 적용 전 미리보기 — 서버가 실행할 것과 같은 계산.
  const preview = useMemo(
    () => (selected ? previewGroupPresetApply(selected.columns, columns, order) : null),
    [selected, columns, order],
  );

  useEffect(() => {
    if ((applyState.ok && applyState.message) || (resetState.ok && resetState.message)) router.refresh();
  }, [applyState, resetState, router]);

  useEffect(() => {
    if (!saveState.ok || !saveState.message) return;
    let active = true;
    const refreshed = createPresetLibraryLoader(() => loadGroupPresetLibraryAction(boardId));
    loader.current = refreshed;
    void refreshed.open().then((result) => {
      if (!active) return;
      setSelectedPresetId("");
      setPresets(result.presets);
      setLibraryMessage(result.message);
      setLibraryState(result.ok ? "ready" : "error");
    });
    router.refresh();
    return () => { active = false; };
  }, [saveState, boardId, router]);


  return (
    <details
      className="relative"
      // 메뉴 안의 클릭이 그룹 머리말(<summary>)의 접기 토글로 새어 나가지 않게 막는다.
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.currentTarget.open = false;
        event.currentTarget.querySelector("summary")?.focus();
      }}
      onToggle={async (event) => {
        if (!event.currentTarget.open || !canEditPresets || libraryState !== "idle") return;
        setLibraryState("loading");
        const result = await loader.current.open();
        setPresets(result.presets);
        setLibraryMessage(result.message);
        setLibraryState(result.ok ? "ready" : "error");
      }}
    >
      <summary
        aria-label={`${presetName} 업무 양식 메뉴`}
        className="flex cursor-pointer list-none items-center gap-1 rounded-full border border-mw-line px-2 py-0.5 hover:bg-mw-bg [&::-webkit-details-marker]:hidden"
      >
        <span>{presetName}</span>
        <span aria-hidden="true" className="text-[0.6rem] text-mw-sub">▾</span>
      </summary>

      <div
        id={panelId}
        className="absolute right-0 z-20 mt-1 flex w-[min(20rem,calc(100vw-2rem))] flex-col gap-3 rounded-xl border border-mw-line bg-mw-card p-3 text-left text-xs shadow-lg"
      >
        <div>
          <p className="font-semibold text-mw-fg">업무 양식</p>
          <p className="mt-0.5 text-mw-sub">이 단계의 기록 항목 묶음을 저장하고, 적용 전에 결과를 미리 봅니다.</p>
        </div>

        {!canEditPresets && (
          <p role="note" className="rounded-lg bg-mw-tint-blue px-2 py-1.5 text-mw-body">
            아이템 프리셋을 저장하려면 «프리셋 편집» 권한이 필요합니다. 회사 관리자에게 요청해 주세요.
          </p>
        )}

        {/* ── 저장 ── */}
        {canEditPresets && savable && (
          <form action={save} className="flex flex-col gap-1.5 border-t border-mw-line pt-3">
            <label className="font-medium text-mw-body" htmlFor={`${panelId}-name`}>
              현재 구조를 프리셋으로 저장
            </label>
            <input type="hidden" name="boardId" value={boardId} />
            <input type="hidden" name="groupKey" value={groupKey} />
            <input type="hidden" name="requestId" value={requestId} />
            <div className="flex gap-1.5">
              <input
                id={`${panelId}-name`}
                name="name"
                required
                defaultValue={presetName}
                className="min-w-0 flex-1 rounded-lg border border-mw-line bg-mw-bg px-2 py-1.5 text-mw-fg outline-none focus:border-mw-record"
              />
              <button
                type="submit"
                disabled={saving}
                className="shrink-0 rounded-lg bg-mw-primary px-2.5 py-1.5 font-semibold text-white disabled:opacity-50"
              >
                {saving ? "저장 중…" : "저장"}
              </button>
            </div>
            <p className="text-mw-sub">컬럼 {columns.length}개를 지금 보이는 순서대로 담습니다.</p>
            <ActionMessage state={saveState} />
          </form>
        )}

        {/* ── 미리보기 ── */}
        {canEditPresets && (
          <div className="flex flex-col gap-1.5 border-t border-mw-line pt-3">
            <label className="font-medium text-mw-body" htmlFor={`${panelId}-preset`}>
              다른 프리셋과 견주기
            </label>
            {libraryState === "idle" ? (
              <p className="text-mw-sub">메뉴를 열면 저장된 프리셋을 불러옵니다.</p>
            ) : libraryState === "loading" ? (
              <p role={noticeRole(true)} aria-live={noticeLive(true)} className="text-mw-sub">프리셋을 불러오는 중…</p>
            ) : libraryState === "error" ? (
              <p role={noticeRole(false)} aria-live={noticeLive(false)} className="text-mw-error">{libraryMessage}</p>
            ) : presets.length === 0 ? (
              <p className="text-mw-sub">저장된 아이템 프리셋이 없습니다. 위에서 이 아이템 구조를 먼저 저장해 보세요.</p>
            ) : (
              <select
                id={`${panelId}-preset`}
                value={selectedPresetId}
                onChange={(event) => setSelectedPresetId(event.target.value)}
                className="rounded-lg border border-mw-line bg-mw-bg px-2 py-1.5 text-mw-fg outline-none focus:border-mw-record"
              >
                <option value="">프리셋을 고르면 미리보기가 나옵니다</option>
                {presets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name} · 컬럼 {preset.columns.length}
                  </option>
                ))}
              </select>
            )}

            {selected && preview && (
              <div className="flex flex-col gap-1.5 rounded-lg bg-mw-bg p-2">
                <p className="font-medium text-mw-body">이 프리셋을 적용하면</p>
                <PreviewLine
                  label="추가되는 컬럼"
                  count={preview.added.length}
                  names={preview.added.map((column) => column.label)}
                />
                <PreviewLine
                  label="이미 있어 그대로 두는 컬럼"
                  count={preview.reused.length}
                  names={preview.reused.map((column) => (column.differs ? `${column.label}(구조 다름 · 값 보존)` : column.label))}
                />
                <PreviewLine
                  label="프리셋에 없어 뒤에 남는 컬럼"
                  count={preview.kept.length}
                  names={preview.kept.map((column) => column.label)}
                />
                <p className="text-mw-sub">컬럼과 입력된 값은 하나도 지워지지 않습니다.</p>
                {preview.added.length > 0 && (
                  <p role="note" className="text-mw-sub">
                    새 컬럼은 보드 공용이라 다른 아이템에도 나타납니다. 다른 아이템의 순서·설정·값은 바뀌지 않습니다.
                  </p>
                )}
                {canManageColumns && savable ? (
                  <form action={apply} className="mt-1 flex flex-col gap-1.5 border-t border-mw-line pt-2">
                    <input type="hidden" name="boardId" value={boardId} />
                    <input type="hidden" name="groupKey" value={groupKey} />
                    <input type="hidden" name="presetId" value={selected.id} />
                    <button
                      type="submit"
                      disabled={applying || preview.noop}
                      className="rounded-lg bg-mw-primary px-2.5 py-1.5 font-semibold text-white disabled:opacity-50"
                    >
                      {applying ? "적용 중…" : preview.noop ? "이미 같은 배치입니다" : "이 아이템에 적용"}
                    </button>
                    <ActionMessage state={applyState} />
                  </form>
                ) : !savable ? (
                  <p role="note" className="text-mw-sub">
                    «그룹 없음» 영역은 저장 대상 아이템이 없어 프리셋을 적용할 수 없습니다.
                  </p>
                ) : (
                  <p role="note" className="text-mw-sub">
                    적용하려면 «컬럼 관리» 권한이 필요합니다. 회사 관리자에게 요청해 주세요.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {order && order.length > 0 && (
          <div className="flex flex-col gap-1.5 border-t border-mw-line pt-3">
            <p className="font-medium text-mw-body">현재 이 아이템은 프리셋 배치에서 변경됨</p>
            <p className="text-mw-sub">컬럼과 입력값은 남기고 보드의 기본 컬럼 순서로 돌아갑니다.</p>
            {canManageColumns ? (
              <form action={reset} className="flex flex-col gap-1.5">
                <input type="hidden" name="boardId" value={boardId} />
                <input type="hidden" name="groupKey" value={groupKey} />
                <button
                  type="submit"
                  disabled={resetting}
                  className="rounded-lg border border-mw-line px-2.5 py-1.5 font-semibold text-mw-body disabled:opacity-50"
                >
                  {resetting ? "되돌리는 중…" : "기본으로 되돌리기"}
                </button>
                <ActionMessage state={resetState} />
              </form>
            ) : (
              <p role="note" className="text-mw-sub">
                되돌리려면 «컬럼 관리» 권한이 필요합니다. 회사 관리자에게 요청해 주세요.
              </p>
            )}
          </div>
        )}

      </div>
    </details>
  );
}

function ActionMessage({ state }: { state: { ok: boolean; message: string | null } }) {
  if (!state.message) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={state.ok ? "text-mw-sub" : "text-mw-error"}>
      {state.message}
    </p>
  );
}

/** 미리보기 한 줄 — 이름을 다 늘어놓으면 375px 에서 메뉴가 화면을 넘긴다. 앞 3개만 보인다. */
function PreviewLine({ label, count, names }: { label: string; count: number; names: string[] }) {
  return (
    <p className="text-mw-body">
      {label} <b>{count}</b>
      {count > 0 && (
        <span className="text-mw-sub"> — {names.slice(0, 3).join(", ")}{count > 3 && ` 외 ${count - 3}`}</span>
      )}
    </p>
  );
}
