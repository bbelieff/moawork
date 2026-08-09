import type { Activity, User } from "@/lib/types";
import { addActivityAction } from "@/app/(app)/deals/[dealId]/actions";

/**
 * 활동 탭 (T02) — 딜의 활동기록 타임라인 + 메모 추가.
 *
 * 단계 이동 로그(type='status')는 서비스가 자동으로 남긴다. 여기서는 사람이 적는
 * 메모/통화/미팅만 입력받는다.
 */

const TYPE_LABEL: Record<string, string> = {
  status: "단계 변경",
  memo: "메모",
  call: "통화",
  meeting: "미팅",
};

function formatAt(iso: string): string {
  // 서버 컴포넌트 — 로케일 고정으로 하이드레이션 불일치를 피한다.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function DealActivityTab({
  dealId,
  activities,
  userById,
}: {
  dealId: string;
  activities: Activity[];
  userById: Map<string, User>;
}) {
  return (
    <div className="flex flex-col gap-6">
      <form action={addActivityAction} className="flex flex-col gap-2">
        <input type="hidden" name="dealId" value={dealId} />
        <div className="flex gap-2">
          <select
            name="type"
            className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            defaultValue="memo"
            aria-label="활동 종류"
          >
            <option value="memo">메모</option>
            <option value="call">통화</option>
            <option value="meeting">미팅</option>
          </select>
          <input
            name="content"
            required
            placeholder="무슨 일이 있었나요?"
            className="flex-1 rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            활동 기록하기
          </button>
        </div>
      </form>

      {activities.length === 0 ? (
        <p className="py-8 text-center text-sm text-zinc-400">
          활동 기록이 아직 없어요.
        </p>
      ) : (
        <ol className="flex flex-col gap-3">
          {activities.map((a) => (
            <li key={a.id} className="flex gap-3 text-sm">
              <span className="mt-0.5 shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {TYPE_LABEL[a.type] ?? a.type}
              </span>
              <div className="min-w-0 flex-1">
                <p className="break-words">{a.content ?? "—"}</p>
                <p className="mt-0.5 text-xs text-zinc-400">
                  {formatAt(a.at)}
                  {a.actor && userById.get(a.actor)
                    ? ` · ${userById.get(a.actor)!.name}`
                    : ""}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
