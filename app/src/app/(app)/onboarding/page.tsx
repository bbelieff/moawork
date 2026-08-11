import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, SESSION_COOKIE } from "@/lib/auth/session";
import { getRepo } from "@/lib/repo";
import { installPolicyfundPreset } from "@/lib/presets/policyfund";
import { FEATURES } from "@/lib/product";

// 온보딩(흐름 A): 조직 생성 → 업종팩(정책자금) 선택 → 홈.
export default async function OnboardingPage() {
  const ctx = await getSession();
  const repo = getRepo();
  const dealFields = repo.listFieldDefs(ctx.org.id, "deal");
  const policyOn = repo.isFeatureEnabled(ctx.org.id, FEATURES.policyfund);

  async function createOrg(formData: FormData) {
    "use server";
    const current = await getSession();
    const name = String(formData.get("name") ?? "").trim() || "새 조직";
    const withPreset = formData.get("preset") === "on";

    const { org } = getRepo().createOrg({ name }, current.user);
    const jar = await cookies();
    jar.set(SESSION_COOKIE.org, org.id, { path: "/" });

    if (withPreset) {
      installPolicyfundPreset({
        user: current.user,
        org,
        role: "owner",
        scope: "all",
      });
    }
    redirect("/");
  }

  async function installPreset() {
    "use server";
    const current = await getSession();
    installPolicyfundPreset(current);
    redirect("/onboarding");
  }

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

      <form
        action={createOrg}
        className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
      >
        <h2 className="text-sm font-semibold">새 조직 만들기</h2>
        <input
          name="name"
          placeholder="조직 이름"
          className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
          <input type="checkbox" name="preset" defaultChecked />
          정책자금 업종팩 프리셋 설치(딜 커스텀필드 전개)
        </label>
        <button
          type="submit"
          className="self-start rounded bg-zinc-900 px-4 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          조직 생성 후 홈으로
        </button>
      </form>

      <form action={installPreset}>
        <button
          type="submit"
          className="rounded border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          현재 조직에 정책자금팩만 설치
        </button>
      </form>

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
