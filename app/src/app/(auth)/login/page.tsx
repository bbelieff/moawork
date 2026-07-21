import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getRepo } from "@/lib/repo";
import { PRODUCT_NAME } from "@/lib/product";
import { SESSION_COOKIE } from "@/lib/auth/session";

// 로컬 개발용 로그인 — Supabase 연결 전까지 "dev-session"(쿠키)으로 로그인한다.
// Supabase 연결 후 이 화면은 구글 OAuth 버튼으로 교체된다(세션 계약은 동일).
export default function LoginPage() {
  const users = getRepo().listUsers();

  async function devLogin(formData: FormData) {
    "use server";
    const uid = formData.get("uid");
    if (typeof uid !== "string") return;
    const jar = await cookies();
    jar.set(SESSION_COOKIE.uid, uid, { path: "/" });
    jar.delete(SESSION_COOKIE.as);
    jar.delete(SESSION_COOKIE.org);
    redirect("/onboarding");
  }

  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-1 flex-col justify-center gap-8 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {PRODUCT_NAME} 로그인
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          개발 세션(dev-session) — 계정을 골라 로그인하세요. 구글 OAuth 는
          Supabase 연결 후 활성화됩니다.
        </p>
      </div>

      <form action={devLogin} className="flex flex-col gap-3">
        {users.map((u) => (
          <button
            key={u.id}
            type="submit"
            name="uid"
            value={u.id}
            className="flex items-center justify-between rounded-lg border border-zinc-200 px-4 py-3 text-left transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            <span className="font-medium">{u.name}</span>
            <span className="text-sm text-zinc-500">{u.email}</span>
          </button>
        ))}
      </form>
    </main>
  );
}
