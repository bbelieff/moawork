"use client";

import { useActionState, useRef, useState } from "react";
import { WorkspaceMark } from "@/components/workspace/WorkspaceMark";
import {
  ORG_LOGO_ALLOWED_MIME,
  ORG_LOGO_IDLE,
  type OrgLogoActionState,
} from "@/lib/org-logo/contracts";
import { formatLogoBytes, ORG_LOGO_ACCEPT_BYTES } from "@/lib/org-logo/compress-plan";
import { compressOrgLogo } from "@/lib/org-logo/compress";
import type { OrgLogoView } from "@/lib/org-logo/server";
import { removeOrgLogoAction, uploadOrgLogoAction } from "@/app/(app)/settings/members/logo-actions";

export type OrgLogoCardProps = {
  orgName: string;
  logo: OrgLogoView;
  /** 서버가 판정한 값만 받는다. 화면은 이 값을 «표시» 할 뿐 권한을 만들지 않는다. */
  canManage: boolean;
};

const ACCEPT = ORG_LOGO_ALLOWED_MIME.join(",");

function Feedback({ state }: { state: OrgLogoActionState }) {
  if (!state.message) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      data-org-logo-feedback={state.ok ? "ok" : (state.reason ?? "error")}
      className={`text-xs ${state.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}
    >
      {state.message}
    </p>
  );
}

/*
 * #652 — 회사 로고.
 *
 * ## 자리를 줄였다
 *
 * 총괄 지적 — 「로고 올리고 적용하는 영역이 페이지 내 영역을 너무 많이 잡아먹고 있음」.
 * 전에는 제목 · 설명 두 줄 · 56px 미리보기 · 파일칸 한 줄 · 안내 한 줄 · 지우기 한 줄이
 * 세로로 쌓여 조직관리 첫 화면의 3분의 1을 먹었다. **로고는 이 화면의 «주인공» 이 아니다.**
 * 한 줄로 눕히고, 미리보기를 40px 로 줄이고, 설명은 필요한 것만 남긴다.
 *
 * ## 올리기 전에 «앱이» 줄인다
 *
 * 총괄 지시 — 「용량제한은 조금 더 여유있게 해주고 자동압축을 해서 권장에 맞춰주는 기능」.
 * 로고는 사이드바에서 32px 로 보이는데 사람이 가진 파일은 인쇄용 2000px · 3MB 다.
 * 「줄여서 다시 올리세요」라고 시키는 대신 **앱이 줄인다.**
 * 줄였으면 얼마나 줄었는지 말한다 — 조용히 바꾸지 않는다.
 */
export function OrgLogoCard({ orgName, logo, canManage }: OrgLogoCardProps) {
  const [uploadState, upload, uploading] = useActionState(uploadOrgLogoAction, ORG_LOGO_IDLE);
  const [removeState, remove, removing] = useActionState(removeOrgLogoAction, ORG_LOGO_IDLE);
  const [prepared, setPrepared] = useState<{ from: number; to: number } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // ★ 로고가 없으면 WorkspaceMark 가 회사명 이니셜로 떨어진다. 빈칸을 만들지 않는다.
  const signedImageUrl = logo.kind === "ready" ? logo.signedUrl : null;

  async function prepare() {
    const input = inputRef.current;
    const file = input?.files?.[0];
    setPrepared(null);
    if (!input || !file) return;
    setPreparing(true);
    try {
      const result = await compressOrgLogo(file);
      if (result.compressed) {
        // 고른 파일을 «줄인 것으로» 바꿔 둔다. 폼이 그대로 제출하면 줄인 것이 올라간다.
        const bag = new DataTransfer();
        bag.items.add(result.file);
        input.files = bag.files;
        setPrepared({ from: result.originalBytes, to: result.file.size });
      }
    } catch {
      // 압축은 편의지 관문이 아니다. 실패하면 원본 그대로 올린다.
    } finally {
      setPreparing(false);
    }
  }

  return (
    <section
      aria-labelledby="org-logo-title"
      data-org-logo-card
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-800"
    >
      <WorkspaceMark name={orgName} signedImageUrl={signedImageUrl} size={40} decorative={false} />

      <div className="min-w-0 flex-1">
        <h2 id="org-logo-title" className="text-sm font-semibold">
          회사 로고
        </h2>
        <p className="text-xs text-zinc-500">
          {logo.kind === "ready" ? (
            <span data-org-logo-status="ready">사이드바에 이 로고가 나와요.</span>
          ) : logo.kind === "unavailable" ? (
            // 「아직 없음」과 「불러오지 못함」을 뭉개지 않는다.
            <span className="text-amber-700 dark:text-amber-400" data-org-logo-status="unavailable">
              로고를 불러오지 못했어요. 이름 첫 글자를 대신 보여주고 있어요.
            </span>
          ) : (
            <span data-org-logo-status="none">
              아직 없어요. 이름 첫 글자가 대신 나옵니다 · PNG · JPG · SVG · {formatLogoBytes(ORG_LOGO_ACCEPT_BYTES)}까지
            </span>
          )}
        </p>
      </div>

      {canManage ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <form action={upload} className="flex min-w-0 items-center gap-2">
            {/* 375px: 파일 입력은 «파일 선택 / 선택된 파일 없음» 때문에 고유 너비가 넓다.
                min-w-0 이 없으면 카드의 min-content 가 뷰포트를 넘어 가로 스크롤이 생긴다. */}
            <input
              ref={inputRef}
              type="file"
              name="logo"
              accept={ACCEPT}
              required
              onChange={prepare}
              aria-label="회사 로고 파일"
              className="w-40 min-w-0 text-xs file:mr-2 file:rounded-lg file:border-0 file:bg-zinc-100 file:px-2.5 file:py-1.5 file:text-xs dark:file:bg-zinc-800"
            />
            <button
              type="submit"
              disabled={uploading || preparing}
              className="shrink-0 rounded-lg bg-[var(--mw-primary)] px-3 py-1.5 text-xs font-semibold text-[var(--mw-on-accent)] disabled:opacity-60"
            >
              {preparing ? "줄이는 중…" : uploading ? "올리는 중…" : "올리기"}
            </button>
          </form>

          {logo.kind === "ready" ? (
            <form action={remove}>
              <button
                type="submit"
                disabled={removing}
                className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs disabled:opacity-60 dark:border-zinc-700"
              >
                {removing ? "지우는 중…" : "지우기"}
              </button>
            </form>
          ) : null}
        </div>
      ) : (
        // ★ 숨기지 않고 «사유와 함께» 보여준다. 왜 못 하는지 읽히게.
        <p role="status" data-org-logo-locked="true" className="text-xs text-zinc-500">
          대표와 관리자만 바꿀 수 있어요.
        </p>
      )}

      {/* 줄였으면 «얼마나» 줄였는지 말한다. 조용히 바꾸지 않는다. */}
      {prepared ? (
        <p role="status" data-org-logo-compressed className="basis-full text-xs text-zinc-500">
          권장 크기에 맞춰 {formatLogoBytes(prepared.from)} → <b>{formatLogoBytes(prepared.to)}</b> 로 줄였어요.
          원본 파일은 그대로 두었어요.
        </p>
      ) : null}
      <div className="basis-full empty:hidden">
        <Feedback state={uploadState} />
        <Feedback state={removeState} />
      </div>
    </section>
  );
}
