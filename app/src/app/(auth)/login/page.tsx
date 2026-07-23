import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { getRepo } from "@/lib/repo";
import { PRODUCT_NAME } from "@/lib/product";
import { AUTH_ERROR_MESSAGES, safeNextPath } from "@/lib/auth/oauth";
import { SESSION_COOKIE } from "@/lib/auth/session";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const nextPath = safeNextPath(
    typeof params.next === "string" ? params.next : undefined,
  );
  const errorCode = typeof params.error === "string" ? params.error : "";
  const errorMessage = AUTH_ERROR_MESSAGES[errorCode];
  const devToolsEnabled = process.env.NODE_ENV !== "production";
  const users = devToolsEnabled ? getRepo().listUsers() : [];

  async function devLogin(formData: FormData) {
    "use server";
    if (process.env.NODE_ENV === "production") return;

    const uid = formData.get("uid");
    if (typeof uid !== "string") return;
    const jar = await cookies();
    jar.set(SESSION_COOKIE.uid, uid, { path: "/", httpOnly: true, sameSite: "lax" });
    jar.delete(SESSION_COOKIE.as);
    jar.delete(SESSION_COOKIE.org);
    redirect("/onboarding");
  }

  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-1 flex-col justify-center gap-8 p-6 sm:p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {PRODUCT_NAME} 로그인
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          하나의 워크스페이스에서 업무를 자유롭게 연결하세요.
        </p>
      </div>

      {errorMessage ? (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          {errorMessage}
        </p>
      ) : null}

      <GoogleSignInButton nextPath={nextPath} />

      {devToolsEnabled ? (
        <section className="flex flex-col gap-3 border-t pt-6" style={{ borderColor: "var(--mw-line)" }}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              개발용 계정
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              로컬 UI와 역할별 범위를 확인할 때만 사용합니다.
            </p>
          </div>
          <form action={devLogin} className="flex flex-col gap-3">
            {users.map((user) => (
              <button
                key={user.id}
                type="submit"
                name="uid"
                value={user.id}
                className="flex min-h-12 flex-col items-start justify-center rounded-xl border px-4 py-3 text-left transition-colors hover:bg-zinc-50 sm:flex-row sm:items-center sm:justify-between dark:hover:bg-zinc-900"
                style={{ borderColor: "var(--mw-line)" }}
              >
                <span className="font-medium">{user.name}</span>
                <span className="break-all text-sm text-zinc-500">{user.email}</span>
              </button>
            ))}
          </form>
        </section>
      ) : null}
    </main>
  );
}
