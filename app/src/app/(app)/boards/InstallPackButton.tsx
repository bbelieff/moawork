import { SEOUL_STRUCTURE_PACK } from "@/lib/structure-packs";
import { installStructurePackAction } from "./actions";
import type { PackInstallFlash } from "./installFlash";

/**
 * 구조 팩 설치 타일 — BBE-102.
 *
 * `NewBoardInline` 과 같은 격자에 놓이는 타일이라 크기·스타일을 맞췄다.
 * 서버 컴포넌트 + 서버 액션 폼 — 클라이언트 JS 불필요(이 화면의 기존 방식 유지).
 */
export function InstallPackButton({ flash }: { flash: PackInstallFlash | null }) {
  return (
    <li className="sm:col-span-2 lg:col-span-3">
      <div className="flex flex-col gap-2 rounded border border-dashed border-zinc-300 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
            {SEOUL_STRUCTURE_PACK.name}
          </span>
          <span className="text-xs text-zinc-500">
            서울경영지원센터 3보드(신규업체·컨텍관리·업무관리) 구조를 한 번에 만듭니다.
          </span>
          <form action={installStructurePackAction} className="ml-auto">
            <button
              type="submit"
              className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
            >
              설치
            </button>
          </form>
        </div>

        {flash && (
          <p className="text-xs text-zinc-600 dark:text-zinc-300" role="status">
            생성 보드 {flash.boards}개 · 그룹 {flash.groups}개
            {flash.skipped > 0 && ` · 건너뜀 ${flash.skipped}개(이미 있음)`}
          </p>
        )}
      </div>
    </li>
  );
}
