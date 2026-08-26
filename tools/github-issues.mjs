/* 관제판이 «지금» 을 읽는 한 곳 — GitHub Issues.
 *
 * 왜 모듈로 뽑았나
 *   판은 두 벌이다. 실시간 판(dashboard-server.mjs)과 구운 판(board/build-board.mjs).
 *   전에는 둘이 각자 Linear GraphQL 을 들고 있었고, 그래서 한쪽만 고치면 다른 쪽이
 *   조용히 다른 것을 말했다. 출처는 한 곳이어야 한다.
 *
 * 2026-08-26 — Linear 는 READ_ONLY_ARCHIVE 다. 카드가 거기서 더 안 움직이므로
 *   판이 «얼어붙은 스냅샷» 을 실시간인 척 보여주고 있었다. 정본을 따라 GitHub 로 옮겼다.
 *
 * 의존성 0 — node 내장 모듈만.
 */
import { execFileSync } from "node:child_process";

export const DEFAULT_REPO = "bbelieff/moawork";

/**
 * 토큰을 «만들지 않는다».
 * 환경변수에 없으면 `gh auth token` 을 한 번 물어본다 — 사람이 어디에 붙여 넣을 것이 없고,
 * 값은 이 함수 밖으로 나가지 않는다(출력·기록 금지).
 */
export function githubToken(env = process.env) {
  const fromEnv = (env.GITHUB_TOKEN || env.GH_TOKEN || "").trim();
  if (fromEnv) return fromEnv;
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

/**
 * 제목 앞의 «P0 ·» 를 우선순위로 읽는다.
 * 이 저장소의 실제 관례다 — 제목 맨 앞이 등급을 들고 다닌다.
 * GitHub 에는 Linear 의 priority 같은 1급 칸이 없으므로 «있는 것» 을 쓴다.
 */
export function priorityFromTitle(title) {
  // 저장소에 두 관례가 «둘 다» 있다 — 「P0 · …」 와 「[P1] …」.
  // 실측(2026-08-26, 카드 204장)에서 후자를 놓쳐 우선순위가 빈 칸으로 나왔다.
  const level = /^\s*\[?P([0-3])\]?(?=[\s·:\]]|$)/.exec(title || "")?.[1];
  return { name: ["Urgent", "High", "Medium", "Low"][Number(level)] ?? "" };
}

/**
 * GitHub 상태를 판의 어휘로 옮긴다.
 *
 * ⚠ 지어내지 않는다. GitHub 이슈가 스스로 아는 것은 «열림/닫힘» 과 라벨뿐이다.
 *   Linear 의 In Review 같은 중간 상태는 GitHub Projects 의 Status 칸에 있는데
 *   그건 이슈 API 로는 안 보인다. 그래서 셋만 말하고, 모르는 것은 Todo 로 둔다 —
 *   «진행 중인 척» 하는 판보다 «모른다» 고 말하는 판이 낫다.
 */
export function statusFromIssue(issue) {
  if (issue.state === "closed") return "Done";
  const labels = (issue.labels || []).map((l) => (typeof l === "string" ? l : l.name));
  if (labels.some((name) => /blocked|차단/i.test(name || ""))) return "Blocked";
  return "Todo";
}

/** 판 한 줄이 쓰는 모양으로 정규화한다. 이 모양이 곧 계약이다. */
export function normalizeIssue(issue) {
  return {
    id: `#${issue.number}`,
    title: issue.title,
    createdAt: issue.created_at,
    status: statusFromIssue(issue),
    updatedAt: issue.updated_at,
    url: issue.html_url ?? null,
    priority: priorityFromTitle(issue.title),
    labels: (issue.labels || []).map((l) => (typeof l === "string" ? l : l.name)).filter(Boolean),
  };
}

export function createGithubReader({ repo = DEFAULT_REPO, api = "https://api.github.com", token, timeoutMs = 8_000 } = {}) {
  const auth = token ?? githubToken();

  async function read(pathAndQuery) {
    const r = await fetch(`${api}${pathAndQuery}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (r.status === 403 || r.status === 429) throw new Error(`rate limit (HTTP ${r.status})`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  return {
    read,
    hasAuth: () => Boolean(auth),
    /** 전량 — 쪽을 넘겨 가며 모은다. PR 은 «이슈» 로 섞여 오므로 뺀다. */
    async listIssues(maxPages = 10) {
      const out = [];
      for (let page = 1; page <= maxPages; page += 1) {
        const batch = await read(`/repos/${repo}/issues?state=all&per_page=100&page=${page}&sort=updated&direction=desc`);
        if (!Array.isArray(batch) || batch.length === 0) break;
        for (const issue of batch) {
          // ⚠ 이 엔드포인트는 PR 도 돌려준다. 판은 «카드» 를 세는 곳이라 뺀다.
          if (issue.pull_request) continue;
          out.push(normalizeIssue(issue));
        }
        if (batch.length < 100) break;
      }
      return out;
    },
    /** 커서는 «쪽 번호» 다. 숫자가 아니면 1쪽으로 돌아간다(옛 커서가 남아 있어도 빈 화면이 되지 않게). */
    async listComments(id, limit, after) {
      const number = String(id).replace(/^#/, "");
      const page = Number(after) > 0 ? Number(after) : 1;
      const rows = await read(`/repos/${repo}/issues/${encodeURIComponent(number)}/comments?per_page=${limit}&page=${page}`);
      const list = Array.isArray(rows) ? rows : [];
      return {
        comments: list
          .map((c) => ({ id: String(c.id), createdAt: c.created_at, updatedAt: c.updated_at, body: c.body ?? "" }))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)),
        pageInfo: {
          hasNextPage: list.length === limit,
          endCursor: list.length === limit ? String(page + 1) : null,
        },
      };
    },
  };
}
