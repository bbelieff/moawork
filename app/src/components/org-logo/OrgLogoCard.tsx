"use client";

import { useActionState } from "react";
import { WorkspaceMark } from "@/components/workspace/WorkspaceMark";
import {
  ORG_LOGO_ALLOWED_MIME,
  ORG_LOGO_IDLE,
  ORG_LOGO_MAX_BYTES,
  type OrgLogoActionState,
} from "@/lib/org-logo/contracts";
import type { OrgLogoView } from "@/lib/org-logo/server";
import { removeOrgLogoAction, uploadOrgLogoAction } from "@/app/(app)/settings/members/logo-actions";

export type OrgLogoCardProps = {
  orgName: string;
  logo: OrgLogoView;
  /** 서버가 판정한 값만 받는다. 화면은 이 값을 «표시» 할 뿐 권한을 만들지 않는다. */
  canManage: boolean;
};

const ACCEPT = ORG_LOGO_ALLOWED_MIME.join(",");
const MAX_MB = Math.round(ORG_LOGO_MAX_BYTES / 1024 / 1024);

function Feedback({ state }: { state: OrgLogoActionState }) {
  if (!state.message) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      data-org-logo-feedback={state.ok ? "ok" : (state.reason ?? "error")}
      className={`text-sm ${state.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}
    >
      {state.message}
    </p>
  );
}

export function OrgLogoCard({ orgName, logo, canManage }: OrgLogoCardProps) {
  const [uploadState, upload, uploading] = useActionState(uploadOrgLogoAction, ORG_LOGO_IDLE);
  const [removeState, remove, removing] = useActionState(removeOrgLogoAction, ORG_LOGO_IDLE);

  // ★ 로고가 없으면 WorkspaceMark 가 회사명 이니셜로 떨어진다. 빈칸을 만들지 않는다.
  const signedImageUrl = logo.kind === "ready" ? logo.signedUrl : null;

  return (
    <section
      aria-labelledby="org-logo-title"
      className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <h2 id="org-logo-title" className="text-base font-semibold">
        회사 로고
      </h2>
      <p className="mt-1 text-sm text-zinc-500">
        사이드바의 회사명 옆에 나타나요. 올리지 않으면 회사 이름의 첫 글자가 표시돼요.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <WorkspaceMark name={orgName} signedImageUrl={signedImageUrl} size={56} decorative={false} />
        <div className="min-w-0 text-sm">
          <p className="font-medium">{orgName}</p>
          {logo.kind === "ready" ? (
            <p className="text-zinc-500" data-org-logo-status="ready">현재 로고를 사용하고 있어요.</p>
          ) : null}
          {logo.kind === "none" ? (
            <p className="text-zinc-500" data-org-logo-status="none">아직 로고가 없어요. 이름 첫 글자를 대신 보여주고 있어요.</p>
          ) : null}
          {logo.kind === "unavailable" ? (
            // 「아직 없음」과 「불러오지 못함」을 뭉개지 않는다.
            <p role="status" className="text-amber-700 dark:text-amber-400" data-org-logo-status="unavailable">
              로고를 불러오지 못했어요. 이름 첫 글자를 대신 보여주고 있어요.
            </p>
          ) : null}
        </div>
      </div>

      {canManage ? (
        <div className="mt-4 flex flex-col gap-3">
          <form action={upload} className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="file"
              name="logo"
              accept={ACCEPT}
              required
              aria-label="회사 로고 파일"
              className="max-w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:text-sm dark:file:bg-zinc-800"
            />
            <button
              type="submit"
              disabled={uploading}
              className="shrink-0 rounded-lg bg-[var(--mw-primary)] px-4 py-2 text-sm font-semibold text-[var(--mw-on-accent)] disabled:opacity-60"
            >
              {uploading ? "올리는 중…" : "로고 올리기"}
            </button>
          </form>
          <p className="text-xs text-zinc-500">PNG · JPG · SVG · {MAX_MB}MB 이하</p>
          <Feedback state={uploadState} />

          {logo.kind === "ready" ? (
            <form action={remove}>
              <button
                type="submit"
                disabled={removing}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm disabled:opacity-60 dark:border-zinc-700"
              >
                {removing ? "지우는 중…" : "로고 지우기"}
              </button>
            </form>
          ) : null}
          <Feedback state={removeState} />
        </div>
      ) : (
        // ★ 숨기지 않고 «사유와 함께» 비활성으로 보여준다. 왜 못 하는지 읽히게.
        <p
          role="status"
          data-org-logo-locked="true"
          className="mt-4 rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"
        >
          회사 로고는 대표와 관리자만 바꿀 수 있어요.
        </p>
      )}
    </section>
  );
}
