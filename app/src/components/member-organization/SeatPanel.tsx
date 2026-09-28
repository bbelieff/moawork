"use client";

import { useActionState, useState } from "react";
import { saveSeatDefinitionAction } from "@/app/(app)/settings/members/seat-actions";
import {
  SEAT_DEFINITION_IDLE,
  type SeatDefinitionState,
} from "@/app/(app)/settings/members/seat-definition-state";
import { seatDefinitionDate, seatDefinitionIsEmpty, type SeatDefinition } from "@/lib/org/seat-definitions";
import { seatName, SEAT_ROLE_LABEL, type Seat } from "@/lib/org/seats";
import { scopeLabel } from "@/lib/auth/roles";

/**
 * 「이 자리」 / 「이 사람」 두 겹 (#683 · D안 1단계).
 *
 * ## ★ 왜 두 겹인가
 *
 * 「이건 다음 사람에게 넘어가나?」는 조직관리에서 가장 자주 나오는 질문이다.
 * 설명으로 답하는 대신 **구조가 답하게 한다** —
 *
 *     「이 자리」 겹에 있는 것   다음 사람에게 넘어간다
 *     「이 사람」 겹에 있는 것   안 넘어간다
 *
 * ## ★ 역할 정의서가 맨 위다
 *
 * 자리를 열었을 때 첫 질문은 「이 자리는 무엇을 하나」다. 권한·알림보다 먼저다.
 * 중요한 순서대로 놓았지 기술 구조 순서로 놓지 않았다.
 */

export type SeatPanelProps = {
  seat: Seat;
  definition: SeatDefinition | null;
  /** null = 정의서를 «못 읽음». 빈 것과 다르다. */
  definitionKnown: boolean;
  canManage: boolean;
};

type Layer = "seat" | "person";

function Feedback({ state }: { state: SeatDefinitionState }) {
  if (!state.message) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      data-seat-feedback={state.ok ? "ok" : "error"}
      className={`text-xs ${state.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}
    >
      {state.message}
    </p>
  );
}

const CYCLE_LABEL: Record<string, string> = { daily: "매일", weekly: "매주", monthly: "매월" };

function dutiesToText(definition: SeatDefinition | null): string {
  if (!definition) return "";
  return definition.duties.map((duty) => `${CYCLE_LABEL[duty.cycle] ?? "매일"}: ${duty.text}`).join("\n");
}

export function SeatPanel({ seat, definition, definitionKnown, canManage }: SeatPanelProps) {
  const [layer, setLayer] = useState<Layer>("seat");
  const [editing, setEditing] = useState(false);
  const [state, save, saving] = useActionState(saveSeatDefinitionAction, SEAT_DEFINITION_IDLE);

  const empty = seatDefinitionIsEmpty(definition);
  const occupant = seat.occupants[0] ?? null;

  return (
    <section
      aria-label={`${seatName(seat)} 상세`}
      data-seat-panel
      className="overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800"
    >
      {/* ★ 이름표 — 「지금 내가 부분을 보고 있다」를 헷갈리지 않게. */}
      <div
        data-region="one"
        className="flex items-center gap-2 bg-indigo-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300"
      >
        {/* ★ 「이 자리 —」를 뗐다. 화면에 자리 하나만 열려 있는데 지시어를 붙일 이유가 없다. */}
        {seatName(seat)}
        <span className="ml-auto text-[11px] font-normal normal-case tracking-normal">
          {seat.status === "unknown" ? (
            <b className="text-amber-700 dark:text-amber-400">모름</b>
          ) : seat.status === "vacant" ? (
            <b className="text-red-700 dark:text-red-400">공석</b>
          ) : (
            `${seat.occupants.length}명`
          )}
        </span>
      </div>

      <div className="flex border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40">
        {(
          [
            ["seat", "자리"],
            ["person", occupant ? `사람 · ${occupant.displayName}` : "사람"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            data-seat-layer={key}
            aria-pressed={layer === key}
            disabled={key === "person" && !occupant}
            onClick={() => setLayer(key)}
            className={`border-b-2 px-3 py-2 text-xs disabled:opacity-40 ${
              layer === key
                ? "border-indigo-500 bg-white font-semibold text-indigo-700 dark:bg-zinc-950 dark:text-indigo-300"
                : "border-transparent text-zinc-500"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {layer === "seat" ? (
        <div className="flex flex-col">
          <div className="border-b border-zinc-100 p-3 dark:border-zinc-900">
            <div className="mb-2 flex items-center gap-2">
              {/* ★ 「역할 정의서」는 서류 이름이다. 사람이 부르는 이름은 「하는 일」이다. */}
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                하는 일
              </span>
              {canManage ? (
                <button
                  type="button"
                  data-seat-edit
                  onClick={() => setEditing((value) => !value)}
                  className="ml-auto rounded-md border border-zinc-300 px-2 py-0.5 text-[11px] dark:border-zinc-700"
                >
                  {editing ? "접기" : empty ? "쓰기" : "고치기"}
                </button>
              ) : null}
            </div>

            {/* ★ «못 읽음» 과 «아직 없음» 을 뭉개지 않는다. */}
            {!definitionKnown ? (
              <p role="status" data-seat-definition="unknown" className="text-xs text-amber-700 dark:text-amber-400">
                하는 일을 불러오지 못했어요. 비어 있다는 뜻은 아니에요.
              </p>
            ) : empty && !editing ? (
              <p data-seat-definition="empty" className="text-xs text-zinc-500">
                아직 아무도 안 썼어요.
                {canManage ? " 「쓰기」를 눌러 이 자리가 뭘 하는지 남겨 주세요." : " 대표나 관리자가 채우면 여기 보여요."}
              </p>
            ) : !editing ? (
              <div data-seat-definition="ready" className="flex flex-col gap-2 rounded-md bg-indigo-50/60 p-3 dark:bg-indigo-950/20">
                {definition?.summary ? (
                  <p className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">{definition.summary}</p>
                ) : null}

                {definition && definition.duties.length > 0 ? (
                  <div>
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">하는 일</div>
                    <ul className="flex flex-col gap-0.5 text-xs">
                      {definition.duties.map((duty, index) => (
                        <li key={`${duty.cycle}-${index}`} className="flex gap-2">
                          <span className="shrink-0 text-zinc-500">{CYCLE_LABEL[duty.cycle]}</span>
                          <span>{duty.text}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {definition && (definition.escalate.length > 0 || definition.handle.length > 0 || definition.avoid.length > 0) ? (
                  <div>
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">판단 기준</div>
                    <div className="flex flex-col gap-1 text-xs">
                      {definition.escalate.length > 0 ? (
                        <p><b>위로 올린다</b> — {definition.escalate.join(" · ")}</p>
                      ) : null}
                      {definition.handle.length > 0 ? (
                        <p><b>직접 처리한다</b> — {definition.handle.join(" · ")}</p>
                      ) : null}
                      {definition.avoid.length > 0 ? (
                        <p><b>손대지 않는다</b> — {definition.avoid.join(" · ")}</p>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {definition?.signals ? (
                  <div>
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">잘하고 있다는 신호</div>
                    <p className="text-xs">{definition.signals}</p>
                  </div>
                ) : null}

                {definition?.handover ? (
                  <div>
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">인수인계 메모</div>
                    <p className="whitespace-pre-wrap text-xs text-zinc-600 dark:text-zinc-300">{definition.handover}</p>
                  </div>
                ) : null}

                {definition?.updatedAt ? (
                  <p className="border-t border-indigo-200/60 pt-1.5 text-[11px] text-zinc-500 dark:border-indigo-900/60">
                    {definition.updatedByName ?? "누군가"}가 씀 ·{" "}
                    {seatDefinitionDate(definition.updatedAt)} 고침 ·{" "}
                    <b>사람이 바뀌어도 남아요</b>
                  </p>
                ) : null}
              </div>
            ) : null}

            {editing && canManage ? (
              <form action={save} className="mt-2 flex flex-col gap-2" data-seat-form>
                <input type="hidden" name="departmentId" value={seat.departmentId ?? ""} />
                <input type="hidden" name="role" value={seat.role} />
                <label className="grid gap-1 text-[11px] text-zinc-500">
                  한 줄로 — 이 자리는 뭘 책임지나
                  <input
                    name="summary"
                    defaultValue={definition?.summary ?? ""}
                    maxLength={400}
                    placeholder="예: 들어온 리드를 3일 안에 첫 통화까지 끌고 간다"
                    className="min-h-9 rounded-lg border border-zinc-300 px-2 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </label>
                <label className="grid gap-1 text-[11px] text-zinc-500">
                  하는 일 — 한 줄에 하나. 「매일: 」 「매주: 」 「매월: 」 로 시작하면 주기가 붙어요
                  <textarea
                    name="duties"
                    rows={3}
                    defaultValue={dutiesToText(definition)}
                    placeholder={"매일: 아침에 「이번 주 재통화」 뷰부터 연다\n매주: 팀 상담 현황을 정리한다"}
                    className="rounded-lg border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </label>
                <div className="grid gap-2 sm:grid-cols-3">
                  <label className="grid gap-1 text-[11px] text-zinc-500">
                    위로 올린다
                    <textarea name="escalate" rows={2} defaultValue={(definition?.escalate ?? []).join("\n")}
                      className="rounded-lg border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900" />
                  </label>
                  <label className="grid gap-1 text-[11px] text-zinc-500">
                    직접 처리한다
                    <textarea name="handle" rows={2} defaultValue={(definition?.handle ?? []).join("\n")}
                      className="rounded-lg border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900" />
                  </label>
                  <label className="grid gap-1 text-[11px] text-zinc-500">
                    손대지 않는다
                    <textarea name="avoid" rows={2} defaultValue={(definition?.avoid ?? []).join("\n")}
                      className="rounded-lg border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900" />
                  </label>
                </div>
                <label className="grid gap-1 text-[11px] text-zinc-500">
                  잘하고 있다는 신호
                  <input name="signals" defaultValue={definition?.signals ?? ""} maxLength={400}
                    className="min-h-9 rounded-lg border border-zinc-300 px-2 text-xs dark:border-zinc-700 dark:bg-zinc-900" />
                </label>
                <label className="grid gap-1 text-[11px] text-zinc-500">
                  인수인계 메모 — 다음 사람에게 남기는 말
                  <textarea name="handover" rows={3} defaultValue={definition?.handover ?? ""}
                    className="rounded-lg border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900" />
                </label>
                <div className="flex items-center gap-2">
                  <button type="submit" disabled={saving}
                    className="rounded-lg bg-[var(--mw-primary)] px-3 py-1.5 text-xs font-semibold text-[var(--mw-on-accent)] disabled:opacity-60">
                    {saving ? "저장 중…" : "저장"}
                  </button>
                  <button type="button" onClick={() => setEditing(false)}
                    className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs dark:border-zinc-700">
                    그만두기
                  </button>
                  <Feedback state={state} />
                </div>
              </form>
            ) : null}
          </div>

          <div className="border-b border-zinc-100 p-3 text-xs dark:border-zinc-900">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              같이 넘어가는 것
            </div>
            <div className="flex gap-2 py-0.5"><span className="w-20 shrink-0 text-zinc-500">부서</span><span>{seat.departmentName ?? "미배정"}</span></div>
            <div className="flex gap-2 py-0.5"><span className="w-20 shrink-0 text-zinc-500">역할</span><span>{SEAT_ROLE_LABEL[seat.role] ?? seat.role}</span></div>
            <div className="flex gap-2 py-0.5">
              <span className="w-20 shrink-0 text-zinc-500">조회 범위</span>
              {/* ★ 범위 이름표도 손으로 적지 않는다 — 지금은 우연히 일치하지만 정본이 바뀌면 어긋난다. */}
              <span>{occupant?.scope ? scopeLabel(occupant.scope) : <span className="text-zinc-400">모름</span>}</span>
            </div>
            <p className="mt-2 text-[11px] text-zinc-500">
              담당 보드 · 저장뷰 · 받는 알림을 자리에 묶는 것은 <b>다음 단계</b>예요.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col">
          <div className="border-b border-zinc-100 p-3 dark:border-zinc-900">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              사람에게 붙는 것 <span className="normal-case tracking-normal">— 자리를 안 따라감</span>
            </div>
            {occupant ? (
              <div className="flex flex-col gap-1 text-xs">
                <div className="flex gap-2 py-0.5"><span className="w-20 shrink-0 text-zinc-500">이름</span><b>{occupant.displayName}</b></div>
                <div className="flex gap-2 py-0.5">
                  <span className="w-20 shrink-0 text-zinc-500">호칭</span>
                  <span>{occupant.titleKnown ? (occupant.title ?? <span className="text-zinc-400">미설정</span>) : <span className="text-zinc-400">모름</span>}</span>
                </div>
                <div className="flex gap-2 py-0.5">
                  <span className="w-20 shrink-0 text-zinc-500">상태</span>
                  <span>{occupant.active ? "활성" : <b className="text-amber-700 dark:text-amber-400">비활성</b>}</span>
                </div>
              </div>
            ) : (
              // ★ «비었다» 와 «모른다» 를 다르게 말한다. 이 부서에 역할을 못 읽은 사람이 있으면
              //   그 사람이 이 자리의 주인일 수 있다 — 「아무도 없다」고 하면 그게 거짓말이 된다.
              <p className="text-xs text-zinc-500">
                {seat.status === "unknown"
                  ? `이 부서에 역할을 모르는 사람이 ${seat.unknownPeers}명 있어요. 비었다고 단정할 수 없어요.`
                  : "아직 아무도 없어요."}
              </p>
            )}
          </div>
          {seat.occupants.length > 1 ? (
            <div className="p-3">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">같은 자리에 있는 사람</div>
              <div className="flex flex-wrap gap-1.5">
                {seat.occupants.map((one) => (
                  <span key={one.userId} className="rounded-full border border-zinc-300 px-2 py-0.5 text-[11px] dark:border-zinc-700">
                    {one.displayName}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
