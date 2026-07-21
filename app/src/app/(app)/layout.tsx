import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { PRODUCT_NAME } from "@/lib/product";

// 인증된 앱 셸. getSession() 이 세션 없으면 /login 으로 보낸다(가드).
// 다른 트랙의 앱 화면은 이 그룹 아래에 두면 로그인/조직 컨텍스트를 자동 확보한다.
export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const ctx = await getSession();

  async function signOut() {
    "use server";
    const jar = await cookies();
    jar.delete("mw_uid");
    jar.delete("mw_org");
    jar.delete("mw_as");
    redirect("/login");
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
        <div className="flex items-center gap-4">
          <span className="font-semibold">{PRODUCT_NAME}</span>
          <nav className="flex gap-3 text-sm text-zinc-600 dark:text-zinc-300">
            <Link href="/" className="hover:underline">
              홈
            </Link>
            <Link href="/boards" className="hover:underline">
              보드
            </Link>
            <Link href="/settings/members" className="hover:underline">
              멤버·권한
            </Link>
            <Link href="/onboarding" className="hover:underline">
              온보딩
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-zinc-500">
            {ctx.org.name} · {ctx.user.name}{" "}
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {ctx.role}/{ctx.scope}
            </span>
          </span>
          <form action={signOut}>
            <button
              type="submit"
              className="rounded border border-zinc-200 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              로그아웃
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
