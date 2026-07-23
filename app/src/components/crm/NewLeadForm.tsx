type NewLeadFormProps = {
  action: (formData: FormData) => Promise<never>;
  requestId: string;
  error?: string;
  created?: boolean;
};

const ERROR_MESSAGES: Record<string, string> = {
  company: "업체명을 입력하고 다시 시도해 주세요.",
  input: "입력값을 확인하고 다시 시도해 주세요.",
  pipeline: "기본 파이프라인의 마케팅 단계를 찾지 못했습니다. 온보딩을 먼저 완료해 주세요.",
  save: "업체와 업무를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
};

export function NewLeadForm({
  action,
  requestId,
  error,
  created = false,
}: NewLeadFormProps) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-4">
        <h2 className="text-base font-semibold">첫 업체 등록</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          업체를 등록하면 마케팅 단계의 업무 카드가 함께 만들어집니다.
        </p>
      </div>

      {error ? (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
        >
          {ERROR_MESSAGES[error] ?? ERROR_MESSAGES.save}
        </div>
      ) : null}

      {created ? (
        <div
          role="status"
          className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"
        >
          업체와 업무 카드를 저장했습니다.
        </div>
      ) : null}

      <form action={action} className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <input type="hidden" name="requestId" value={requestId} />
        <label className="grid gap-1.5 text-sm font-medium">
          업체명
          <input
            name="companyName"
            required
            maxLength={160}
            autoComplete="organization"
            placeholder="예: 모아상사"
            className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm outline-none transition focus:border-mw-primary focus:ring-2 focus:ring-mw-primary/20 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          업무명 <span className="font-normal text-zinc-400">(선택)</span>
          <input
            name="dealTitle"
            maxLength={200}
            placeholder="비워두면 업체명으로 생성"
            className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm outline-none transition focus:border-mw-primary focus:ring-2 focus:ring-mw-primary/20 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <button
          type="submit"
          className="h-10 rounded-lg bg-mw-primary px-5 text-sm font-semibold text-mw-on-accent transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mw-primary"
        >
          업체와 업무 만들기
        </button>
      </form>
    </section>
  );
}
