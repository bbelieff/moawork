"use client";

/**
 * 통합 타임라인 (BBE-16) — activities(자동기록) + comments(사람이 씀)를 시간순으로 보여준다.
 *
 * "무엇이 언제 바뀌었는가는 자동으로 쌓인다" — 여기 보이는 활동 항목(단계 이동·담당자
 * 변경)은 사람이 적는 게 아니라 서비스(`AsyncCrmService`)가 상태 변경 시점에 자동으로
 * `activities` 에 남긴 것을 그대로 렌더한다. 이 컴포넌트는 표시만 한다.
 *
 * 댓글 동시수정 충돌: 저장 시 `expectedEditedAt` 을 함께 보내고, 서버가 그 사이 값이
 * 바뀌었으면 `ConcurrentEditError` 를 던진다 — 여기서 그 메시지를 그대로 보여준다
 * (덮어쓰지 않는다).
 */

import { useState, useTransition } from "react";
import type { Activity } from "@/lib/types";
import type { DealComment } from "@/lib/deal/comments";
import type { TimelineEntry } from "@/lib/deal/timeline";
import type { OrgMemberOption } from "@/lib/deal/members";
import {
  addCommentAction,
  editCommentAction,
} from "@/app/(app)/deals/[dealId]/actions";

const ACTIVITY_TYPE_LABEL: Record<string, string> = {
  status: "단계 변경",
  assignment: "담당자 변경",
  memo: "메모",
  call: "통화",
  meeting: "미팅",
};

function formatAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 본문의 `@이름` 을 강조 표시(순수 렌더링용 — 알림 대상 판정에는 쓰지 않는다). */
function renderBodyWithMentions(body: string): React.ReactNode {
  const parts = body.split(/(@[^\s@]{1,50})/g);
  return parts.map((part, i) =>
    part.startsWith("@") ? (
      <strong key={i} className="text-zinc-900 dark:text-zinc-100">
        {part}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function ActivityRow({ activity }: { activity: Activity }) {
  return (
    <li className="flex gap-2 py-2 text-sm text-zinc-500">
      <span className="shrink-0 tabular-nums">{formatAt(activity.at)}</span>
      <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
        {ACTIVITY_TYPE_LABEL[activity.type] ?? activity.type}
      </span>
      <span className="text-zinc-700 dark:text-zinc-200">{activity.content}</span>
    </li>
  );
}

function CommentRow({
  dealId,
  comment,
  authorName,
  canEdit,
}: {
  dealId: string;
  comment: DealComment;
  authorName: string | null;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        await editCommentAction(dealId, comment.id, {
          body: draft,
          expectedVersion: comment.version,
        });
        setEditing(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "저장하지 못했습니다.");
      }
    });
  }

  const isReturnRequest = comment.kind === "return_request";

  return (
    <li
      className={`flex flex-col gap-1 rounded-lg border p-3 text-sm ${
        isReturnRequest
          ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"
          : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        <span className="font-medium text-zinc-700 dark:text-zinc-200">
          {authorName ?? "알 수 없음"}
        </span>
        {isReturnRequest && (
          <span className="rounded bg-amber-500 px-1.5 py-0.5 text-[11px] font-medium text-white">
            되돌려보내기
          </span>
        )}
        <span>{formatAt(comment.created_at)}</span>
        {comment.edited_at && <span>(수정됨)</span>}
        {canEdit && !editing && (
          <button
            type="button"
            onClick={() => {
              setDraft(comment.body);
              setEditing(true);
            }}
            className="ml-auto text-zinc-400 hover:text-zinc-700 hover:underline dark:hover:text-zinc-200"
          >
            수정
          </button>
        )}
      </div>

      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            disabled={pending}
            className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          {error && (
            <p role="alert" className="text-xs text-red-600">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="rounded-md bg-zinc-900 px-3 py-1 text-xs text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
            >
              저장
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={pending}
              className="rounded-md border border-zinc-300 px-3 py-1 text-xs dark:border-zinc-700"
            >
              취소
            </button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-zinc-700 dark:text-zinc-200">
          {renderBodyWithMentions(comment.body)}
        </p>
      )}

      {comment.edit_history.length > 0 && !editing && (
        <details className="text-xs text-zinc-400">
          <summary className="cursor-pointer select-none">
            이전 내용 {comment.edit_history.length}건
          </summary>
          <ul className="mt-1 flex flex-col gap-1 border-l border-zinc-200 pl-2 dark:border-zinc-700">
            {comment.edit_history.map((h, i) => (
              <li key={i}>
                <span className="tabular-nums">{formatAt(h.at)}</span> · {h.body}
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

export interface DealTimelineProps {
  dealId: string;
  entries: TimelineEntry[];
  nameById: Map<string, string | null>;
  currentUserId: string;
  /** 댓글 작성 가능 여부(담당범위 밖이면 읽기 전용). */
  canComment: boolean;
  /** @멘션 후보(본인 제외는 호출부가 이미 걸러서 넘긴다). */
  mentionCandidates: OrgMemberOption[];
}

export function DealTimeline({
  dealId,
  entries,
  nameById,
  currentUserId,
  canComment,
  mentionCandidates,
}: DealTimelineProps) {
  const [body, setBody] = useState("");
  const [mentioned, setMentioned] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggleMention(id: string) {
    setMentioned((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        await addCommentAction(dealId, { body, mentionedIds: [...mentioned] });
        setBody("");
        setMentioned(new Set());
      } catch (e) {
        setError(e instanceof Error ? e.message : "댓글을 저장하지 못했습니다.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {entries.length === 0 ? (
        <p className="rounded border border-dashed border-zinc-200 p-4 text-sm text-zinc-400 dark:border-zinc-800">
          아직 활동이나 댓글이 없습니다.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) =>
            entry.kind === "activity" ? (
              <ActivityRow key={`a-${entry.activity.id}`} activity={entry.activity} />
            ) : (
              <CommentRow
                key={`c-${entry.comment.id}`}
                dealId={dealId}
                comment={entry.comment}
                authorName={nameById.get(entry.comment.author_id) ?? null}
                canEdit={canComment && entry.comment.author_id === currentUserId}
              />
            ),
          )}
        </ul>
      )}

      {canComment && (
        <div className="flex flex-col gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="댓글을 입력하세요. @이름 으로 언급할 사람을 아래에서 골라 부를 수 있어요."
            rows={3}
            disabled={pending}
            className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          {mentionCandidates.length > 0 && (
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="text-zinc-400">언급할 사람:</span>
              {mentionCandidates.map((m) => (
                <label
                  key={m.id}
                  className="flex items-center gap-1 rounded border border-zinc-200 px-1.5 py-0.5 dark:border-zinc-700"
                >
                  <input
                    type="checkbox"
                    checked={mentioned.has(m.id)}
                    onChange={() => toggleMention(m.id)}
                  />
                  {m.name ?? "이름 없음"}
                </label>
              ))}
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <div>
            <button
              type="button"
              onClick={submit}
              disabled={pending || body.trim() === ""}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
            >
              댓글 남기기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
