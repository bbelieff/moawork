import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { createRequestCustomService } from "@/lib/custom/server";
import { loadLockedFeatures } from "@/lib/entitlements/server";
import { FEATURES } from "@/lib/product";

// 온보딩(흐름 A): 조직 생성 → 업종팩(정책자금) 선택 → 홈.
export default async function OnboardingPage() {
  const ctx = await getSession();
  const custom = await createRequestCustomService();
  const [dealFields, locked] = await Promise.all([
    custom.listFields(ctx.org.id, "deal"),
    loadLockedFeatures(ctx.org.id, [FEATURES.policyfund]),
  ]);
  const policyOn = !locked.includes(FEATURES.policyfund);

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold">온보딩</h1>
        <p className="mt-1 text-sm text-zinc-500">
          현재 조직: <strong>{ctx.org.name}</strong> · 정책자금팩{" "}
          {policyOn ? "설치됨" : "미설치"} · 딜 커스텀필드 {dealFields.length}개
        </p>
      </div>

      <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-sm font-semibold">연습 회사에서 퀘스트 해보기</h2>
        <p className="mt-1 text-sm text-zinc-500">실제 회사와 분리된 공간에서 업무 조작을 연습해요.</p>
        <Link className="mt-3 inline-flex min-h-11 items-center rounded border px-3 text-sm" href="/onboarding/practice">
          연습 퀘스트 열기
        </Link>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-sm font-semibold">워크스페이스 관리</h2>
        <p className="text-sm text-zinc-500">새 조직 생성과 기본 탭 준비는 안전한 워크스페이스 진입 흐름에서 진행합니다.</p>
        <Link className="self-start rounded bg-zinc-900 px-4 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900" href="/workspace-entry">
          워크스페이스 선택으로 이동
        </Link>
      </section>

      {dealFields.length > 0 ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold">
            전개된 딜 커스텀필드 ({dealFields.length})
          </h2>
          <ul className="flex flex-wrap gap-2">
            {dealFields.map((f) => (
              <li
                key={f.id}
                className="rounded bg-zinc-100 px-2 py-1 text-xs dark:bg-zinc-800"
              >
                {f.label}
                <span className="ml-1 text-zinc-400">({f.type})</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
