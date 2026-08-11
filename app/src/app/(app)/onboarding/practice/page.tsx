import { OnboardingPanel } from "@/components/onboarding/OnboardingPanel";
import { getSession } from "@/lib/auth/session";
import { loadMyPracticeSnapshot } from "@/lib/onboarding/server";

export default async function PracticeOnboardingPage() {
  const ctx = await getSession();
  const result = await loadMyPracticeSnapshot(ctx.user);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4">
      <header>
        <p className="text-sm" style={{ color: "var(--mw-sub)" }}>온보딩</p>
        <h1 className="text-xl font-semibold">연습 회사 퀘스트</h1>
      </header>
      <OnboardingPanel
        snapshot={result.ok ? result.snapshot : null}
        error={result.ok ? undefined : result.reason}
        revalidatePath="/onboarding/practice"
      />
    </main>
  );
}
