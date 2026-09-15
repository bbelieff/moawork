import type { ReactElement } from "react";
import Link from "next/link";
import type { PracticeSnapshot } from "@/lib/onboarding/server";
import { refreshQuestsAction, startPracticeAction, updateAutomationQuestAction } from "./actions";

export type OnboardingPanelProps = {
  /** 아직 연습 회사가 없으면 null(진입 화면을 보여준다). */
  snapshot: PracticeSnapshot | null;
  /** snapshot 조회를 시도했는데 실패했으면 사유 — 화면에서 «권한 없음»과 «장애»를 구분한다. */
  error?: "permission" | "unavailable";
  revalidatePath?: string;
  showManagementByDefault?: boolean;
};

function StartScreen({ revalidatePath }: { revalidatePath?: string }): ReactElement {
  return (
    <section className="rounded-md border p-4" style={{ background: "var(--mw-card)", borderColor: "var(--mw-line)" }}>
      <h2 className="font-semibold">연습 회사에서 먼저 손에 익혀보세요</h2>
      <p className="mt-1 text-sm" style={{ color: "var(--mw-sub)" }}>
        진짜 회사와 절대 섞이지 않는 연습 전용 공간이 만들어져요. 실제로 조작해야 퀘스트가 통과돼요.
      </p>
      <form action={startPracticeAction} className="mt-3">
        {revalidatePath && <input type="hidden" name="path" value={revalidatePath} />}
        <button type="submit" className="rounded border px-3 py-1.5 text-sm" style={{ borderColor: "var(--mw-line)" }}>
          연습 시작
        </button>
      </form>
    </section>
  );
}

function ErrorScreen({ error }: { error: "permission" | "unavailable" }): ReactElement {
  if (error === "permission") {
    return (
      <section role="alert" className="rounded-md border p-4" style={{ background: "var(--mw-card)", borderColor: "var(--mw-line)" }}>
        <h2 className="font-semibold">이 연습 회사는 볼 수 없어요</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--mw-sub)" }}>내 연습 회사가 아니에요.</p>
      </section>
    );
  }
  return (
    <section role="alert" className="rounded-md border p-4" style={{ background: "var(--mw-card)", borderColor: "var(--mw-line)" }}>
      <h2 className="font-semibold">퀘스트 정보를 불러오지 못했어요</h2>
      <p className="mt-1 text-sm" style={{ color: "var(--mw-sub)" }}>잠시 후 다시 시도해 주세요.</p>
    </section>
  );
}

export function OnboardingPanel({ snapshot, error, revalidatePath, showManagementByDefault = false }: OnboardingPanelProps): ReactElement {
  if (error) {
    return <ErrorScreen error={error} />;
  }
  if (!snapshot) {
    return <StartScreen revalidatePath={revalidatePath} />;
  }

  const visibleQuests = snapshot.quests.filter((quest) => !quest.hidden);
  const automationQuests = snapshot.quests.filter((quest) => quest.source === "automation" && quest.ruleId);
  const passedCount = visibleQuests.filter((q) => q.completed).length;

  return (
    <section className="rounded-md border p-4" style={{ background: "var(--mw-card)", borderColor: "var(--mw-line)" }}>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">
          연습 퀘스트 <span style={{ color: "var(--mw-sub)" }}>{passedCount} / {visibleQuests.length}</span>
        </h2>
        <form action={refreshQuestsAction}>
          <input type="hidden" name="orgId" value={snapshot.orgId} />
          {revalidatePath && <input type="hidden" name="path" value={revalidatePath} />}
          <button type="submit" className="rounded border px-2 py-1 text-xs" style={{ borderColor: "var(--mw-line)" }}>
            다시 확인
          </button>
        </form>
      </div>

      <ul className="mt-3 flex flex-col gap-2">
        {visibleQuests.map((q) => (
          <li
            key={q.questKey}
            data-quest-key={q.questKey}
            data-completed={q.completed}
            className="flex items-start gap-2 rounded border px-3 py-2"
            style={{ borderColor: "var(--mw-line)" }}
          >
            <span aria-hidden="true">{q.completed ? "✅" : "⬜"}</span>
            <div>
              <div className="text-sm font-medium">{q.title}</div>
              {q.description && (
                <div className="text-xs" style={{ color: "var(--mw-sub)" }}>{q.description}</div>
              )}
              {q.why && (
                <div className="mt-1 text-xs" style={{ color: "var(--mw-sub)" }}>
                  왜 필요한가요? {q.why}
                </div>
              )}
              {q.source === "automation" && (
                <div className="mt-1 text-xs" style={{ color: "var(--mw-sub)" }}>
                  통과 조건: 이 자동화 규칙이 실제로 실행되면 완료돼요.
                </div>
              )}
            </div>
            <span className="sr-only">{q.completed ? "통과" : "미통과"}</span>
          </li>
        ))}
      </ul>
      {automationQuests.length > 0 && (
        <details className="mt-4 rounded border p-3" open={showManagementByDefault} style={{ borderColor: "var(--mw-line)" }}>
          <summary className="cursor-pointer text-sm font-medium">자동화 퀘스트 관리</summary>
          <p className="mt-1 text-xs" style={{ color: "var(--mw-sub)" }}>
            설명과 표시 여부만 바뀌며 자동화 규칙 자체는 계속 동작합니다.
          </p>
          <div className="mt-3 flex flex-col gap-3">
            {automationQuests.map((quest) => (
              <form
                action={updateAutomationQuestAction}
                className="rounded border p-3"
                key={`manage-${quest.questKey}`}
                style={{ borderColor: "var(--mw-line)" }}
              >
                <input type="hidden" name="orgId" value={snapshot.orgId} />
                <input type="hidden" name="ruleId" value={quest.ruleId} />
                <input type="hidden" name="path" value={revalidatePath ?? "/onboarding/practice"} />
                <div className="text-sm font-medium">{quest.title}</div>
                <label className="mt-2 block text-xs" style={{ color: "var(--mw-sub)" }}>
                  왜 필요한가요?
                  <textarea
                    className="mt-1 min-h-20 w-full rounded border bg-transparent px-2 py-1.5 text-sm"
                    defaultValue={quest.why ?? ""}
                    name="why"
                    /* BBE-206: --mw-text 는 정의된 적 없어 글자색이 부모색으로 새고 있었다. 정본은 --mw-fg. */
                    style={{ borderColor: "var(--mw-line)", color: "var(--mw-fg)" }}
                  />
                </label>
                <label className="mt-2 flex min-h-11 items-center gap-2 text-sm">
                  <input type="hidden" name="hidden" value="false" />
                  <input type="checkbox" name="hidden" value="true" defaultChecked={quest.hidden} />
                  학습 목록에서 숨기기
                </label>
                <button
                  className="mt-2 min-h-11 rounded border px-3 text-sm"
                  style={{ borderColor: "var(--mw-line)" }}
                  type="submit"
                >
                  설정 저장
                </button>
              </form>
            ))}
          </div>
        </details>
      )}
      <Link
        className="mt-3 inline-flex min-h-11 items-center rounded border px-3 text-sm"
        href="/boards"
      >
        연습 업무 화면 열기
      </Link>
    </section>
  );
}
