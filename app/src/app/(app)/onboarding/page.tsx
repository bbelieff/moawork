import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession, SESSION_COOKIE } from "@/lib/auth/session";
import { getRepo } from "@/lib/repo";
import { installPolicyfundPreset } from "@/lib/presets/policyfund";
import { FEATURES } from "@/lib/product";
import { EntitlementReadError, isEnabled } from "@/lib/entitlements";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import {
  bootstrapWorkspace,
  renameWorkspace,
} from "@/lib/workspace/service";

// 온보딩(흐름 A): 조직 생성 → 업종팩(정책자금) 선택 → 홈.
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ first?: string; error?: string }>;
}) {
  const ctx = await getSession();
  const params = await searchParams;
  const supabaseMode = hasSupabaseEnv();
  const repo = getRepo();
  const dealFields = supabaseMode
    ? []
    : repo.listFieldDefs(ctx.org.id, "deal");
  let policyOn = false;
  let entitlementError = false;
  try {
    policyOn = await isEnabled(ctx, FEATURES.policyfund);
  } catch (error) {
    if (!(error instanceof EntitlementReadError)) throw error;
    entitlementError = true;
  }

  async function createOrg(formData: FormData) {
    "use server";
    const current = await getSession();
    const rawName = formData.get("name");
    const withPreset = formData.get("preset") === "on";

    if (hasSupabaseEnv()) {
      let failed = false;
      try {
        const supabase = await createClient();
        // RPC가 미적용/거부된 환경에서는 이름만 바뀐 상태를 만들지 않는다.
        await bootstrapWorkspace(supabase, current.org.id);
        await renameWorkspace(supabase, current.org.id, rawName);
      } catch {
        failed = true;
      }
      if (failed) redirect("/onboarding?first=1&error=workspace");
      redirect("/");
    }

    const name = String(rawName ?? "").trim() || "새 조직";
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
    if (hasSupabaseEnv()) {
      let failed = false;
      try {
        await bootstrapWorkspace(await createClient(), current.org.id);
      } catch {
        failed = true;
      }
      if (failed) redirect("/onboarding?error=workspace");
      redirect("/");
    }
    installPolicyfundPreset(current);
    redirect("/onboarding");
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold">
          {params.first === "1" ? "워크스페이스 시작하기" : "온보딩"}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          현재 조직: <strong>{ctx.org.name}</strong> · 정책자금팩{" "}
          {entitlementError
            ? "권한 확인 오류"
            : policyOn
              ? "사용 가능"
              : "미설치"}
          {!supabaseMode ? ` · 딜 커스텀필드 ${dealFields.length}개` : null}
        </p>
      </div>

      {params.error === "workspace" || entitlementError ? (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
        >
          워크스페이스를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.
        </div>
      ) : null}

      <form
        action={createOrg}
        className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
      >
        <h2 className="text-sm font-semibold">
          {supabaseMode ? "워크스페이스 이름" : "새 조직 만들기"}
        </h2>
        <input
          name="name"
          placeholder="조직 이름"
          defaultValue={supabaseMode ? ctx.org.name : undefined}
          required={supabaseMode}
          maxLength={80}
          className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        {supabaseMode ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            기본 CRM 파이프라인과 여섯 단계, 현재 플랜의 기능을 함께 준비합니다.
          </p>
        ) : (
          <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
            <input type="checkbox" name="preset" defaultChecked />
            정책자금 업종팩 프리셋 설치(딜 커스텀필드 전개)
          </label>
        )}
        <button
          type="submit"
          className="self-start rounded bg-zinc-900 px-4 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          {supabaseMode ? "저장하고 시작하기" : "조직 생성 후 홈으로"}
        </button>
      </form>

      {!supabaseMode ? (
        <form action={installPreset}>
          <button
            type="submit"
            className="rounded border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            현재 조직에 정책자금팩만 설치
          </button>
        </form>
      ) : null}

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
