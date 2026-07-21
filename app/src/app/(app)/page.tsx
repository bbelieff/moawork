import Link from "next/link";
import { applyAs, getSession } from "@/lib/auth/session";
import { getRepo } from "@/lib/repo";
import { FeatureGate } from "@/components/auth/FeatureGate";
import { FEATURES } from "@/lib/product";
import type { MemberRole } from "@/lib/types";

// 홈(대시보드 스텁). ?as=owner|admin|member 로 역할·담당범위를 바꿔 스코프 격리를 시연한다.
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const asParam = typeof sp.as === "string" ? sp.as : undefined;

  const base = await getSession();
  const ctx = applyAs(base, asParam);

  const repo = getRepo();
  const deals = repo.listDeals(ctx);
  const companies = repo.listCompanies(ctx);
  const fieldDefs = repo.listFieldDefs(ctx.org.id, "deal");
  const stages = repo.listPipelines(ctx.org.id).flatMap((p) =>
    repo.listStages(p.id),
  );
  const stageName = (id: string | null) =>
    stages.find((s) => s.id === id)?.name ?? "-";

  const roles: MemberRole[] = ["owner", "admin", "member"];

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-zinc-500">보기 역할(개발용):</span>
        {roles.map((r) => (
          <Link
            key={r}
            href={`/?as=${r}`}
            className={`rounded border px-2 py-1 text-xs ${
              ctx.role === r
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
            }`}
          >
            {r}
          </Link>
        ))}
        <span className="ml-2 text-xs text-zinc-400">
          현재 {ctx.role}/{ctx.scope} — member+assigned 는 본인 담당만 보입니다.
        </span>
      </section>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="딜" value={deals.length} />
        <Stat label="고객사" value={companies.length} />
        <Stat label="딜 커스텀필드" value={fieldDefs.length} />
        <Stat
          label="정책자금팩"
          value={
            getRepo().isFeatureEnabled(ctx.org.id, FEATURES.policyfund)
              ? "ON"
              : "OFF"
          }
        />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
          내 딜 ({deals.length})
        </h2>
        <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {deals.length === 0 ? (
            <li className="p-3 text-sm text-zinc-400">담당 딜이 없습니다.</li>
          ) : (
            deals.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between p-3 text-sm"
              >
                <span>{d.title}</span>
                <span className="text-zinc-500">{stageName(d.stage_id)}</span>
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <FeatureGate ctx={ctx} feature={FEATURES.crm} label="영업·고객(core.crm)">
          <div className="rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
            ✅ 영업·고객 모듈 사용 가능
          </div>
        </FeatureGate>
        <FeatureGate ctx={ctx} feature={FEATURES.notify} label="알림톡(mod.notify)">
          <div className="rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
            알림톡 모듈
          </div>
        </FeatureGate>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}
