import type { ReactElement } from "react";
import type { PracticeSnapshot } from "@/lib/onboarding/server";
import { refreshQuestsAction, startPracticeAction } from "./actions";

export type OnboardingPanelProps = {
  /** 아직 연습 회사가 없으면 null(진입 화면을 보여준다). */
  snapshot: PracticeSnapshot | null;
  /** snapshot 조회를 시도했는데 실패했으면 사유 — 화면에서 «권한 없음»과 «장애»를 구분한다. */
  error?: "permission" | "unavailable";
  revalidatePath?: string;
};

function StartScreen({ revalidatePath }: { revalidatePath?: string }): ReactElement {
  return (
    <section className="rounded-xl border p-4" style={{ background: "var(--mw-card)", borderColor: "var(--mw-line)" }}>
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
      <section role="alert" className="rounded-xl border p-4" style={{ background: "var(--mw-card)", borderColor: "var(--mw-line)" }}>
        <h2 className="font-semibold">이 연습 회사는 볼 수 없어요</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--mw-sub)" }}>내 연습 회사가 아니에요.</p>
      </section>
    );
  }
  return (
    <section role="alert" className="rounded-xl border p-4" style={{ background: "var(--mw-card)", borderColor: "var(--mw-line)" }}>
      <h2 className="font-semibold">퀘스트 정보를 불러오지 못했어요</h2>
      <p className="mt-1 text-sm" style={{ color: "var(--mw-sub)" }}>잠시 후 다시 시도해 주세요.</p>
    </section>
  );
}

export function OnboardingPanel({ snapshot, error, revalidatePath }: OnboardingPanelProps): ReactElement {
  if (error) {
    return <ErrorScreen error={error} />;
  }
  if (!snapshot) {
    return <StartScreen revalidatePath={revalidatePath} />;
  }

  const passedCount = snapshot.quests.filter((q) => q.completed).length;

  return (
    <section className="rounded-xl border p-4" style={{ background: "var(--mw-card)", borderColor: "var(--mw-line)" }}>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">
          연습 퀘스트 <span style={{ color: "var(--mw-sub)" }}>{passedCount} / {snapshot.quests.length}</span>
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
        {snapshot.quests.map((q) => (
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
            </div>
            <span className="sr-only">{q.completed ? "통과" : "미통과"}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
