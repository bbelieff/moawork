"use client";

/**
 * 행 우클릭 메뉴 — #845 개선안(2026-10-08, 승인 목업 Rows).
 *   옆에 열기 · 업체명 바꾸기 | 휴지통으로 이동
 *
 * 업체명 칸에서 「열기」「삭제」 단추를 걷어 낸 대신, 같은 일을 이 메뉴에서 한다.
 * 마우스 오른쪽 단추(누른 자리에 뜬다)와 키보드 Shift+F10 · 메뉴 키(초점이 있는 칸 아래에 뜬다)로 연다.
 * 모양·키보드 이동·Esc·바깥 누르기 닫힘은 탭 ▾ 메뉴와 같은 BoardAnchoredMenu 를 쓰고,
 * 같은 보드의 다른 메뉴가 열리면 서로 닫힌다(useBoardSurface).
 */

import { useCallback, useEffect, useId, useRef } from "react";
import { BoardAnchoredMenu } from "./BoardAnchoredMenu";
import { BoardDialogPortal } from "./BoardDialogPortal";
import { MenuItem, useBoardSurface } from "./BoardHeaderMenus";

/** 메뉴 너비 — BoardAnchoredMenu 가 쓰는 값과 같다(누른 자리에서 오른쪽으로 펼치려고 쓴다). */
const MENU_WIDTH = 232;

export type RowContextMenuRequest = Readonly<{
  rowId: string;
  title: string;
  /** 메뉴 왼쪽 위가 올 화면 좌표. */
  x: number;
  y: number;
  canRename: boolean;
  canTrash: boolean;
}>;

/** 우클릭이면 누른 자리, 키보드면 초점이 있는 요소의 왼쪽 아래. */
export function rowContextMenuPoint(event: { clientX: number; clientY: number }, target: Element | null): { x: number; y: number } {
  if ((event.clientX !== 0 || event.clientY !== 0) || !target) return { x: event.clientX, y: event.clientY };
  const box = target.getBoundingClientRect();
  return { x: box.left, y: box.bottom };
}

export function RowContextMenu({
  boardId,
  request,
  renameLabel,
  onClose,
  onOpenBeside,
  onRename,
  onTrash,
}: {
  boardId: string;
  request: RowContextMenuRequest | null;
  /** 「업체명 바꾸기」 처럼 보드에 맞춘 글자. */
  renameLabel: string;
  /** restoreFocus — Esc 로 닫았을 때만 true(초점을 행 이름으로 돌려준다). */
  onClose(restoreFocus: boolean): void;
  onOpenBeside(rowId: string): void;
  onRename(rowId: string): void;
  onTrash(rowId: string): void;
}) {
  const open = request !== null;
  const anchorRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = `${useId().replace(/:/gu, "")}-row-menu`;
  const closeQuietly = useCallback(() => onClose(false), [onClose]);
  const claim = useBoardSurface(boardId, closeQuietly);
  const rowId = request?.rowId ?? null;

  // 열릴 때마다(다른 행에서 다시 열어도) 같은 보드의 다른 메뉴를 닫는다.
  useEffect(() => {
    if (rowId) claim();
  }, [claim, rowId, request?.x, request?.y]);

  if (!request) return null;

  const run = (action: () => void) => {
    onClose(false);
    action();
  };

  return (
    <>
      {/* 보이지 않는 닻 — 메뉴 너비만큼 넓혀 두면 BoardAnchoredMenu 가 누른 자리에서 오른쪽으로 펼친다. */}
      <BoardDialogPortal>
        <span
          ref={anchorRef}
          aria-hidden="true"
          data-row-menu-anchor
          style={{ position: "fixed", left: request.x, top: request.y, width: MENU_WIDTH, height: 0, pointerEvents: "none" }}
        />
      </BoardDialogPortal>
      <BoardAnchoredMenu
        id={menuId}
        open={open}
        anchorRef={anchorRef}
        menuRef={menuRef}
        label={`${request.title} 행 메뉴`}
        onClose={onClose}
      >
        <MenuItem onClick={() => run(() => onOpenBeside(request.rowId))}>옆에 열기</MenuItem>
        {request.canRename ? (
          <MenuItem onClick={() => run(() => onRename(request.rowId))}>{renameLabel}</MenuItem>
        ) : null}
        {request.canTrash ? (
          <>
            <div role="separator" className="my-1 border-t border-mw-line" />
            <MenuItem danger onClick={() => run(() => onTrash(request.rowId))}>휴지통으로 이동</MenuItem>
          </>
        ) : null}
      </BoardAnchoredMenu>
    </>
  );
}
