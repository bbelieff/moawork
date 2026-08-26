/* 관제판 실시간 서버 — node tools/dashboard-server.mjs
 *
 * 무엇을 하나
 *   tools/board/board.template.html 을 «그대로» 내보내되,
 *   window.cowork.callMcpTool 만 «GitHub 를 지금 읽어오는 것» 으로 갈아끼운다.
 *
 * 왜 이 구조인가 (docs/design/관제판_표준규격_v1.md §9)
 *   Cowork 판 · 구운 판(build-board.mjs) · 이 실시간 판이 «같은 템플릿» 을 쓴다.
 *   갈아끼우는 것은 데이터 공급뿐이라 렌더링 코드가 한 줄도 갈라지지 않는다.
 *   디자인을 세 번 고치는 일이 없다.
 *
 * 왜 서버가 GitHub 를 부르나
 *   토큰을 브라우저에 내보내면 그건 «노출» 이 아니라 «양도» 다.
 *   서버가 대신 부르면 토큰은 이 컴퓨터 밖으로 안 나간다.
 *   질의도 서버가 소유한다 — 화면이 아무 주소나 못 부르므로 구조적으로 쓰기가 불가능하다.
 *
 * 2026-08-26 — 출처를 Linear 에서 GitHub Issues 로 옮겼다.
 *   Linear 는 READ_ONLY_ARCHIVE 라 거기서 카드가 더 안 움직인다.
 *   판이 «지난 스냅샷» 을 실시간인 척 보여주고 있었다.
 *
 * 의존성 0 — node 내장 모듈만. npm install 필요 없다.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ROOT = path.join(import.meta.dirname, "..");
/* 템플릿 찾기 — 저장소 안이든(데스크톱) 서버에 홀로 놓였든(VPS) 둘 다 된다 */
const TEMPLATE = [
  process.env.BOARD_TEMPLATE,                                   // 직접 지정
  path.join(ROOT, "tools", "board", "board.template.html"),     // 저장소 배치
  path.join(import.meta.dirname, "board.template.html"),        // 서버 파일 옆
].filter(Boolean).find((p) => fs.existsSync(p))
  || path.join(ROOT, "tools", "board", "board.template.html");
const PROJECT = "MoaWork · 운영 안정화 및 어드민";

/* ── .env 읽기 ───────────────────────────────────────────── */
function loadEnv() {
  const out = {};
  for (const f of [process.env.DASHBOARD_ENV_FILE, path.join(import.meta.dirname, ".env"), path.join(ROOT, ".env"), path.join(ROOT, ".env.local")].filter(Boolean)) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 0) continue;
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      out[t.slice(0, i).trim()] = v;
    }
  }
  return out;
}
const ENV = { ...loadEnv(), ...process.env };
const PORT = Number(ENV.DASHBOARD_PORT || 8787);
const REPO_ROOT = path.resolve(ENV.MOAWORK_REPO_ROOT || ROOT);
const FUEL_FILE = path.join(ROOT, "tools", "board", "fuel.json");
/* ── GitHub ──────────────────────────────────────────────────
 * 2026-08-26 — 판의 «지금» 을 여기서 읽는다.
 *
 * 왜 바꿨나: 이 판은 Linear 를 읽고 있었는데 Linear 는 READ_ONLY_ARCHIVE 다.
 *   전환 뒤로 카드가 거기서 더 안 움직이므로, 판은 «지난 스냅샷» 을 실시간인 척 보여줬다.
 *   정본이 GitHub Issues 로 옮겨졌으니 판도 거기를 봐야 한다.
 *
 * 토큰을 «내가 만들지 않는다»: 환경변수에 없으면 `gh auth token` 을 한 번 물어본다.
 *   총괄이 따로 설정할 것이 없고, 값은 이 변수 밖으로 나가지 않는다(출력·기록 금지).
 */
/** 인증이 되어 있는가 — 없으면 화면이 «어떻게 로그인하는지» 를 말해 준다. */
const AUTH_OK = () => Boolean(githubToken());
const GITHUB_REPO = (ENV.MOAWORK_GITHUB_REPO || "bbelieff/moawork").trim();
const GITHUB_API = (() => {
  const fallback = "https://api.github.com";
  if (ENV.NODE_ENV !== "test" || !ENV.GITHUB_API_TEST_URL) return fallback;
  try {
    const candidate = new URL(ENV.GITHUB_API_TEST_URL);
    return ["127.0.0.1", "localhost", "::1"].includes(candidate.hostname)
      ? candidate.href.replace(/\/$/, "")
      : fallback;
  } catch {
    return fallback;
  }
})();

let githubTokenCache;
function githubToken() {
  if (githubTokenCache !== undefined) return githubTokenCache;
  const fromEnv = (ENV.GITHUB_TOKEN || ENV.GH_TOKEN || "").trim();
  if (fromEnv) return (githubTokenCache = fromEnv);
  try {
    // gh 가 이미 로그인돼 있으면 여기서 받는다 — 총괄이 토큰을 붙여 넣을 일이 없다.
    githubTokenCache = execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    githubTokenCache = "";
  }
  return githubTokenCache;
}

async function gh(pathAndQuery) {
  const token = githubToken();
  const r = await fetch(`${GITHUB_API}${pathAndQuery}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (r.status === 403 || r.status === 429) throw new Error(`rate limit (HTTP ${r.status})`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/**
 * 제목 앞의 «P0 ·» 를 우선순위로 읽는다.
 * 이 저장소의 실제 관례다 — 「P0 · …」 처럼 제목 맨 앞이 등급을 들고 다닌다.
 * GitHub 에는 Linear 의 priority 같은 1급 칸이 없으므로 «있는 것» 을 쓴다.
 */
function priorityFromTitle(title) {
  const level = /^\s*P([0-3])\b/.exec(title || "")?.[1];
  return { name: ["Urgent", "High", "Medium", "Low"][Number(level)] ?? "" };
}

/**
 * GitHub 상태를 판의 어휘로 옮긴다.
 *
 * ⚠ 지어내지 않는다. GitHub 이슈가 스스로 아는 것은 «열림/닫힘» 과 라벨뿐이다.
 *   Linear 의 In Review 같은 중간 상태는 GitHub Projects 의 Status 칸에 있는데,
 *   그건 이슈 API 로는 안 보인다. 그래서 여기서는 셋만 말하고, 모르는 것은 Todo 로 둔다 —
 *   «진행 중인 척» 하는 판보다 «모른다» 고 말하는 판이 낫다.
 */
function statusFromIssue(issue) {
  if (issue.state === "closed") return "Done";
  const labels = (issue.labels || []).map((l) => (typeof l === "string" ? l : l.name));
  if (labels.some((name) => /blocked|차단/i.test(name || ""))) return "Blocked";
  return "Todo";
}

const Q_COMMENTS = `
query($id:String!,$first:Int!,$after:String){
  issue(id:$id){
    comments(first:$first,after:$after,orderBy:createdAt){
      pageInfo{ hasNextPage endCursor }
      nodes{ id createdAt updatedAt body }
    }
  }
}`;

/* 댓글 읽기는 build()의 active-card 필터 및 45초 snapshot과 독립한다.
   반환 순서는 createdAt 내림차순, 같은 시각이면 id 오름차순으로 고정한다. */
const COMMENT_DEFAULT_LIMIT = 20;
const COMMENT_MAX_LIMIT = 100;
const COMMENT_TTL = 10_000;
const commentCache = new Map();
const commentInFlight = new Map();
const deliveryEvidenceCache = new Map();

function commentCacheKey(id, limit, after) {
  return JSON.stringify([id, limit, after ?? null]);
}

async function getComments(id, limit, after, force = false) {
  const key = commentCacheKey(id, limit, after);
  const cached = commentCache.get(key);
  if (!force && cached && Date.now() - cached.at < COMMENT_TTL) return cached.data;
  if (commentInFlight.has(key)) return commentInFlight.get(key);

  const pending = (async () => {
    // id 는 «#563» 모양이다(build 가 그렇게 만든다). 숫자만 떼어 쓴다.
    const number = String(id).replace(/^#/, "");
    // GitHub 코멘트는 오래된 것부터 온다. 마지막 쪽을 받아 뒤집으면 «최신 N개» 가 된다.
    // 커서는 «쪽 번호» 다. 옛 판이 넘기던 Linear 커서 문자열이 와도 1쪽으로 돌아간다 —
    // 빈 화면을 내는 것보다 처음부터 보여 주는 편이 낫다.
    const page = Number(after) > 0 ? Number(after) : 1;
    const raw = await gh(`/repos/${GITHUB_REPO}/issues/${encodeURIComponent(number)}/comments?per_page=${limit}&page=${page}`);
    const rows = Array.isArray(raw) ? raw : [];
    const comments = rows
      .map((c) => ({
        id: String(c.id),
        createdAt: c.created_at,
        updatedAt: c.updated_at,
        body: c.body ?? "",
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    const data = {
      comments,
      pageInfo: {
        // 한 쪽을 꽉 채워 왔으면 다음 쪽이 있을 수 있다. 커서는 «쪽 번호» 다.
        hasNextPage: rows.length === limit,
        endCursor: rows.length === limit ? String(page + 1) : null,
      },
    };
    commentCache.set(key, { at: Date.now(), data });
    return data;
  })();
  commentInFlight.set(key, pending);
  try {
    return await pending;
  } finally {
    commentInFlight.delete(key);
  }
}

function parseCommentRequest(url) {
  const id = (url.searchParams.get("id") || "").trim();
  if (!id) return { error: "MISSING_ID", message: "id가 필요하다." };
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? COMMENT_DEFAULT_LIMIT : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > COMMENT_MAX_LIMIT) {
    return { error: "INVALID_LIMIT", message: `limit은 1~${COMMENT_MAX_LIMIT} 정수여야 한다.` };
  }
  const after = url.searchParams.get("after") || null;
  return { id, limit, after };
}

/* ── 스냅샷 — 45초에 한 번만 Linear 를 친다 ──────────────────
   화면은 카드마다 코멘트를 부른다(30~40회). 그때마다 Linear 를 치면
   rate limit 에 걸린다. 스냅샷 한 벌을 만들어 두고 전부 거기서 답한다. */
const TTL = 45_000;
let snap = { at: 0, building: null, data: null, error: null };

async function build() {
  const issues = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await gh(`/repos/${GITHUB_REPO}/issues?state=all&per_page=100&page=${page}&sort=updated&direction=desc`);
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const i of batch) {
      // ⚠ 이 엔드포인트는 PR 도 «이슈» 로 돌려준다. 판은 카드를 세는 곳이라 PR 은 뺀다.
      if (i.pull_request) continue;
      issues.push({
        id: `#${i.number}`,
        title: i.title,
        createdAt: i.created_at,
        status: statusFromIssue(i),
        updatedAt: i.updated_at,
        url: i.html_url ?? null,
        priority: priorityFromTitle(i.title),
        labels: (i.labels || []).map((l) => (typeof l === "string" ? l : l.name)).filter(Boolean),
      });
    }
    if (batch.length < 100) break;
  }

  const builtAt = new Date().toISOString();
  return { issues, builtAt, lastSuccessAt: builtAt, available: true, stale: false, error: null };
}

/*
 * ⚠ 아래 `linear*` 이름들은 «남겨 둔» 것이다 — 이제 담기는 값은 GitHub 것이다.
 *   `linearRead` · `linearAvailable` · `linearStatus` · `linearError` 등은 응답 필드 이름이고
 *   board.template.html 이 그대로 읽는다(18곳). 이름만 바꾸면 판이 조용히 빈 화면이 되는데,
 *   그걸 확인하려면 판을 띄워 눈으로 봐야 한다. 그래서 «데이터 출처를 옮기는 일» 과
 *   «이름을 고치는 일» 을 한 커밋에 섞지 않았다. 이름 정리는 판을 띄운 채로 별건으로 한다.
 *   사용자에게 보이는 문구는 이미 GitHub 로 바꿨다(아래 message).
 */
function linearReadFailure(error) {
  const rateLimited = /rate limit|too many requests|429/i.test(String(error?.message || error));
  return {
    code: rateLimited ? "GITHUB_RATE_LIMITED" : "GITHUB_UNAVAILABLE",
    message: rateLimited ? "GitHub 조회 제한에 도달했습니다." : "GitHub 상태를 읽지 못했습니다.",
    retryAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

async function getSnap(force = false) {
  if (!force && snap.data && Date.now() - snap.at < TTL) return snap.data;
  if (snap.building) return snap.building;          // 같은 refresh의 issues+operations는 한 번만 읽는다
  snap.building = (async () => {
    try {
      const d = await build();
      snap = { at: Date.now(), building: null, data: d, error: null };
      console.log(`· 스냅샷 갱신 — 카드 ${d.issues.length}`);
      return d;
    } catch (e) {
      snap.building = null;
      const error = linearReadFailure(e);
      snap.error = error;
      if (snap.data) return { ...snap.data, available: false, stale: true, error, lastSuccessAt: snap.data.lastSuccessAt || snap.data.builtAt };
      return { issues: [], builtAt: null, lastSuccessAt: null, available: false, stale: true, error };
    }
  })();
  return snap.building;
}

/* ── 템플릿에 «실시간» 껍데기를 끼운다 ────────────────────── */
/* ── Git/GitHub 운영 스냅샷 ────────────────────────────────────────────────
   셸을 거치지 않고 read-only 명령만 실행한다. Linear 45초 캐시와 책임을 분리한다. */
const OPS_TTL = 60_000;
let operationsSnap = { at: 0, building: null, data: null };
const QA_TTL = 5 * 60_000;
let qaSnap = { at: 0, data: null };

function safeToolError(error) {
  const code = typeof error?.code === "string" ? error.code : "UNAVAILABLE";
  return { code, message: "운영 상태를 읽지 못했습니다." };
}

async function runReadOnly(command, args, timeout = 15_000) {
  const { stdout } = await execFileAsync(command, args, {
    cwd: REPO_ROOT,
    windowsHide: true,
    timeout,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout.trim();
}

async function readQaDifference() {
  if (qaSnap.data && Date.now() - qaSnap.at < QA_TTL) return qaSnap.data;
  try {
    let output;
    try {
      output = await runReadOnly(process.execPath, ["docs/design/qa-app.mjs"], 120_000);
    } catch (error) {
      /* qa-app은 차이가 있으면 보고값을 stdout에 남기고 exit 1 한다. 이는 측정 성공이다. */
      output = String(error?.stdout || "");
      if (!output) throw error;
    }
    const match = output.match(/차이 합계:\s*(\d+)개/);
    if (!match) throw new Error("difference marker missing");
    qaSnap = { at: Date.now(), data: { available: true, value: Number(match[1]), measuredAt: new Date().toISOString(), ttlMs: QA_TTL } };
  } catch (error) {
    qaSnap = { at: Date.now(), data: { available: false, value: null, measuredAt: new Date().toISOString(), ttlMs: QA_TTL, error: safeToolError(error) } };
  }
  return qaSnap.data;
}

function readFuel() {
  try {
    const value = JSON.parse(fs.readFileSync(FUEL_FILE, "utf8"));
    return { available: true, claude: value.claude ?? null, codex: value.codex ?? null, updatedAt: value.updatedAt ?? fs.statSync(FUEL_FILE).mtime.toISOString() };
  } catch {
    return { available: false, claude: null, codex: null, updatedAt: null };
  }
}

function unwrap(result, key) {
  const parsed = JSON.parse(result || "{}");
  if (!parsed.ok) throw new Error(parsed.error?.code || "orca failed");
  return parsed.result?.[key];
}

function inferEngine(task, dispatch) {
  const text = [task.task_title, task.display_name, dispatch.process_incarnation].filter(Boolean).join(" ");
  return text.match(/(?:^|[^A-Z])(DC|DG|NC|NG)(?:-\d{2})?(?:[^A-Z]|$)/i)?.[1]?.toUpperCase() || "측정 실패";
}

function worktreeOf(dispatch) {
  const value = String(dispatch.process_incarnation || "");
  const match = value.match(/::(.+?)@@/);
  return match?.[1] || null;
}

async function readWorkers() {
  try {
    const runs = unwrap(await runReadOnly("orca", ["orchestration", "run-list", "--json"]), "runs") || [];
    const taskGroups = await Promise.all(runs.filter((run) => !run.legacy).map(async (run) => {
      const tasks = unwrap(await runReadOnly("orca", ["orchestration", "task-list", "--run", run.id, "--json"]), "tasks") || [];
      return tasks.filter((task) => task.status === "dispatched").map((task) => ({ run, task }));
    }));
    const active = taskGroups.flat();
    const rows = await Promise.all(active.map(async ({ run, task }) => {
      const dispatch = unwrap(await runReadOnly("orca", ["orchestration", "dispatch-show", "--task", task.id, "--json"]), "dispatch") || {};
      const lastActivityAt = dispatch.last_heartbeat_at || dispatch.dispatched_at || task.created_at || null;
      const ageMs = lastActivityAt ? Date.now() - new Date(lastActivityAt.replace(" ", "T") + (lastActivityAt.includes("Z") ? "" : "Z")).getTime() : null;
      return {
        taskId: task.id, dispatchId: dispatch.id || task.dispatch_id, runId: run.id,
        cardId: task.task_title?.match(/BBE-\d+/)?.[0] || null,
        engine: inferEngine(task, dispatch), status: dispatch.status || task.status,
        worktree: worktreeOf(dispatch), lastActivityAt,
        stalled: ageMs === null || ageMs > 5 * 60_000,
      };
    }));
    return { available: true, items: rows, measuredAt: new Date().toISOString(), staleAfterMs: 5 * 60_000 };
  } catch (error) {
    return { available: false, items: [], measuredAt: new Date().toISOString(), error: safeToolError(error) };
  }
}

async function readTodayGit() {
  try {
    const raw = await runReadOnly("git", ["log", "--since=midnight", "--date=iso-strict", "--pretty=format:%H%x09%ad%x09%s"]);
    return raw ? raw.split(/\r?\n/).map((line) => { const [sha, at, ...subject] = line.split("\t"); return { type: "git", id: sha.slice(0, 8), at, title: subject.join("\t") }; }) : [];
  } catch { return null; }
}

function checkSummary(checks = []) {
  const summary = { success: 0, failing: 0, pending: 0, total: checks.length };
  for (const check of checks) {
    const conclusion = String(check.conclusion || "").toUpperCase();
    const status = String(check.status || "").toUpperCase();
    const state = String(check.state || "").toUpperCase();
    if (["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED"].includes(conclusion)) summary.failing += 1;
    else if (["FAILURE", "ERROR"].includes(state)) summary.failing += 1;
    else if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(conclusion)) summary.success += 1;
    else if (state === "SUCCESS") summary.success += 1;
    else if (status && status !== "COMPLETED") summary.pending += 1;
    else summary.pending += 1;
  }
  return summary;
}

const DELIVERY_STAGE = Object.freeze({
  WORK_REVIEW: "WORK_REVIEW",
  MERGE_WAITING: "MERGE_WAITING",
  DEPLOYMENT_WAITING: "DEPLOYMENT_WAITING",
  PRODUCTION_COMPLETE: "PRODUCTION_COMPLETE",
  HOSTED_WAITING: "HOSTED_WAITING",
});

const TERMINAL_ISSUE_STATUSES = new Set(["Done", "Canceled", "Duplicate"]);
const HAND_NEEDED_LABELS = new Set(["belie결정", "blocked-external", "needs-hosted", "needs-auth-qa"]);

function isHandNeeded(issue) {
  if (TERMINAL_ISSUE_STATUSES.has(issue.status)) return false;
  return issue.status === "Blocked" || issue.labels.some((label) => HAND_NEEDED_LABELS.has(label));
}

function terminalIssueCompletion(issues) {
  const done = issues.filter((issue) => TERMINAL_ISSUE_STATUSES.has(issue.status)).length;
  return { done, total: issues.length, percent: issues.length ? Math.round(done / issues.length * 100) : 0 };
}

function cardIdFromPr(pr) {
  return [pr.title, pr.headRefName, ...(pr.labels || []).map((label) => label.name || label)].filter(Boolean).join(" ").match(/BBE-\d+/i)?.[0]?.toUpperCase() || null;
}

function classifyDelivery({ issue, pr, deployment, loginStatus, commentEvidence }) {
  const hostedRequired = issue.labels.includes("needs-hosted");
  const mergedSha = pr?.mergeCommitSha || null;
  const mainMerged = Boolean(pr?.baseRefName === "main" && pr?.mergedAt && mergedSha && pr?.mainContainsMerge === true);
  const exactReady = Boolean(mainMerged && deployment?.state === "SUCCESS" && deployment.sha === mergedSha);
  const runtimeErrorCount = deployment?.runtimeErrorCount ?? (commentEvidence?.runtimeZero ? 0 : null);
  const hostedApplied = !hostedRequired || commentEvidence?.hostedApplied === true;
  const blockers = [];
  if (!hostedApplied) blockers.push("HOSTED_REQUIRED_UNVERIFIED");
  if (issue.status === "Done" && !exactReady) blockers.push("LINEAR_DONE_WITHOUT_PRODUCTION");
  if (mainMerged && deployment?.sha && deployment.sha !== mergedSha) blockers.push("PRODUCTION_SHA_MISMATCH");
  if (loginStatus !== 200) blockers.push(loginStatus === null ? "LOGIN_UNMEASURED" : "LOGIN_NOT_200");
  if (runtimeErrorCount !== 0) blockers.push("RUNTIME_UNMEASURED_OR_ERROR");

  if (mainMerged && !hostedApplied) return { stage: DELIVERY_STAGE.HOSTED_WAITING, complete: false, blockers, runtimeErrorCount, hostedRequired, hostedApplied };
  if (exactReady && loginStatus === 200 && runtimeErrorCount === 0 && hostedApplied) return { stage: DELIVERY_STAGE.PRODUCTION_COMPLETE, complete: true, blockers, runtimeErrorCount, hostedRequired, hostedApplied };
  if (mainMerged) return { stage: DELIVERY_STAGE.DEPLOYMENT_WAITING, complete: false, blockers, runtimeErrorCount, hostedRequired };
  const checks = pr?.checks;
  if (pr && !pr.isDraft && checks?.total > 0 && checks.failing === 0 && checks.pending === 0) {
    return { stage: DELIVERY_STAGE.MERGE_WAITING, complete: false, blockers, runtimeErrorCount, hostedRequired };
  }
  return { stage: DELIVERY_STAGE.WORK_REVIEW, complete: false, blockers, runtimeErrorCount, hostedRequired };
}

function parseDeliveryCommentEvidence(comments, mergeSha) {
  const exactSha = String(mergeSha || "").toLowerCase();
  let runtimeZero = false;
  let runtimeNonzero = false;
  let hostedApplied = false;
  for (const comment of comments) {
    const body = String(comment.body || "");
    const normalized = body.toLowerCase().replace(/[`*_]/g, " ").replace(/\s+/g, " ");
    const bindsExactSha = exactSha.length === 40 && normalized.includes(exactSha);
    const runtimeLines = body.split(/\r?\n/).filter((line) => /runtime/i.test(line));
    const hasRuntimeNonzero = runtimeLines.some((line) => /(?:error|fatal)s?(?:\s+(?:count|code))?\s*[:=]?\s*[1-9]\d*/i.test(line));
    const hasRuntimeZero = !hasRuntimeNonzero && (
      /runtime[^\n]{0,80}(?:error\s*\/?\s*fatal|error|fatal)[^\n]{0,40}(?:\b0\b|\bzero\b)/i.test(body)
      || /runtime\s+(?:error0(?:\s*\/\s*fatal0)?|fatal0|error\/fatal\s*0)/i.test(normalized)
    );
    if (bindsExactSha && hasRuntimeZero) runtimeZero = true;
    if (bindsExactSha && hasRuntimeNonzero) runtimeNonzero = true;
    const hasHostedApply = /hosted[^\n]{0,100}(?:apply|applied|적용)/i.test(body);
    const hasPostflight = /postflight[^\n]{0,60}(?:pass|성공|완료|exact)/i.test(body);
    const hasCustomerDmlZero = /customer\s*dml\s*0|고객\s*dml\s*0/i.test(normalized);
    if (bindsExactSha && hasHostedApply && hasPostflight && hasCustomerDmlZero) hostedApplied = true;
  }
  return { runtimeZero: runtimeZero && !runtimeNonzero, hostedApplied };
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await mapper(values[index], index);
    }
  }));
  return results;
}

async function readDeliveryCommentEvidence(rows, force = false, readComments = getComments) {
  const entries = await mapWithConcurrency(rows, 4, async ({ issue, pr }) => {
    if (!pr?.mergeCommitSha) return [issue.id, { runtimeZero: false, hostedApplied: false }];
    const evidenceKey = JSON.stringify([issue.id, pr.mergeCommitSha]);
    const cached = deliveryEvidenceCache.get(evidenceKey);
    const issueUpdatedAt = issue.updatedAt || null;
    const complete = cached?.evidence.runtimeZero
      && (!issue.labels?.includes("needs-hosted") || cached.evidence.hostedApplied);
    const retryDue = cached?.retryAfter && Date.now() >= cached.retryAfter;
    const refreshIncomplete = force && cached && !complete
      && (cached.issueUpdatedAt !== issueUpdatedAt || retryDue);
    if (cached && !refreshIncomplete) return [issue.id, cached.evidence];
    try {
      /* 같은 issue+mergeSHA의 완성된 증거는 영구 재사용한다. 미완성 증거만
         Linear updatedAt이 전진한 강제 갱신에서 한 번 다시 읽는다. */
      const page = await readComments(issue.id, COMMENT_MAX_LIMIT, null, false);
      const evidence = parseDeliveryCommentEvidence(page.comments, pr.mergeCommitSha);
      deliveryEvidenceCache.set(evidenceKey, { evidence, issueUpdatedAt, retryAfter: null });
      return [issue.id, evidence];
    } catch {
      const evidence = cached?.evidence || { runtimeZero: false, hostedApplied: false };
      deliveryEvidenceCache.set(evidenceKey, { evidence, issueUpdatedAt, retryAfter: Date.now() + 60_000 });
      return [issue.id, evidence];
    }
  });
  return new Map(entries);
}

function cachedDeliveryCommentEvidence(rows) {
  return new Map(rows.map(({ issue, pr }) => {
    const key = JSON.stringify([issue.id, pr?.mergeCommitSha || null]);
    return [issue.id, deliveryEvidenceCache.get(key)?.evidence || { runtimeZero: false, hostedApplied: false }];
  }));
}

async function within(promise, timeoutMs, fallback) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => { timer = setTimeout(() => resolve(fallback()), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function readProductionEvidence(force = false) {
  if (!force && readProductionEvidence.cache && Date.now() - readProductionEvidence.cache.at < 60_000) return readProductionEvidence.cache.data;
  try {
    const query = `query { repository(owner:"bbelieff", name:"moawork") { deployments(first:100, environments:["Production"], orderBy:{field:CREATED_AT,direction:DESC}) { nodes { databaseId commitOid createdAt latestStatus { state environmentUrl updatedAt } } } } }`;
    const raw = await runReadOnly("gh", ["api", "graphql", "-f", `query=${query}`]);
    const deployments = JSON.parse(raw || "{}").data?.repository?.deployments?.nodes || [];
    const runtimeEvidence = (() => {
      try {
        const rows = JSON.parse(ENV.DASHBOARD_RUNTIME_EVIDENCE_JSON || "[]");
        return new Map(rows.filter((row) => row?.sha && Number.isInteger(row?.runtimeErrorCount)).map((row) => [row.sha, row]));
      } catch {
        return new Map();
      }
    })();
    const items = deployments.map((deployment) => ({
      id: deployment.databaseId,
      sha: deployment.commitOid,
      state: String(deployment.latestStatus?.state || "").toUpperCase(),
      url: deployment.latestStatus?.environmentUrl || null,
      updatedAt: deployment.latestStatus?.updatedAt || deployment.createdAt,
      runtimeErrorCount: runtimeEvidence.get(deployment.commitOid)?.runtimeErrorCount ?? null,
      runtimeMeasuredAt: runtimeEvidence.get(deployment.commitOid)?.measuredAt ?? null,
    }));
    let loginStatus = null;
    try {
      const response = await fetch("https://www.moa-work.com/login", { redirect: "manual", signal: AbortSignal.timeout(10_000) });
      loginStatus = response.status;
    } catch {}
    const data = { available: true, items, loginStatus, measuredAt: new Date().toISOString(), source: "GitHub/Vercel Production deployments" };
    readProductionEvidence.cache = { at: Date.now(), data };
    return data;
  } catch (error) {
    return { available: false, items: [], loginStatus: null, measuredAt: new Date().toISOString(), error: safeToolError(error) };
  }
}

async function buildOperations(force = false) {
  if (ENV.NODE_ENV === "test" && ENV.DASHBOARD_OPERATIONS_TEST_FIXTURE) {
    return JSON.parse(ENV.DASHBOARD_OPERATIONS_TEST_FIXTURE);
  }

  const productionPromise = readProductionEvidence(force);
  const gitReads = await Promise.allSettled([
    runReadOnly("git", ["rev-parse", "--abbrev-ref", "HEAD"]),
    runReadOnly("git", ["rev-parse", "origin/main"]),
    runReadOnly("git", ["status", "--porcelain=v1"]),
    runReadOnly("git", ["rev-list", "--left-right", "--count", "HEAD...origin/main"]),
  ]);
  const repository = { available: gitReads.every((read) => read.status === "fulfilled") };
  if (repository.available) {
    const [branch, originMain, statusText, distanceText] = gitReads.map((read) => read.value);
    const changes = statusText ? statusText.split(/\r?\n/).filter(Boolean) : [];
    const [ahead = 0, behind = 0] = distanceText.split(/\s+/).map(Number);
    Object.assign(repository, {
      branch,
      originMain,
      originMainShort: originMain.slice(0, 8),
      dirty: changes.length > 0,
      dirtyCount: changes.length,
      changes: changes.slice(0, 20),
      ahead,
      behind,
    });
  } else {
    repository.error = safeToolError(gitReads.find((read) => read.status === "rejected")?.reason);
  }

  let pullRequests;
  try {
    const raw = await runReadOnly("gh", [
      "pr", "list", "--repo", "bbelieff/moawork", "--state", "all", "--limit", "100",
      "--json", "number,title,body,url,state,mergedAt,mergeCommit,headRefName,headRefOid,baseRefName,isDraft,mergeStateStatus,updatedAt,statusCheckRollup,labels",
    ]);
    const rows = JSON.parse(raw || "[]");
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
    const currentRows = rows.filter((pr) => pr.baseRefName === "main" && (pr.state === "OPEN" || (pr.mergedAt && new Date(pr.mergedAt).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }) === today)));
    const mainMembership = await Promise.all(currentRows.map(async (pr) => {
      if (!pr.mergedAt || !pr.mergeCommit?.oid) return false;
      try {
        await runReadOnly("git", ["merge-base", "--is-ancestor", pr.mergeCommit.oid, "origin/main"]);
        return true;
      } catch {
        return false;
      }
    }));
    pullRequests = {
      available: true,
      count: currentRows.filter((pr) => pr.state === "OPEN").length,
      items: currentRows.map((pr, index) => ({
        number: pr.number,
        title: pr.title,
        cardId: cardIdFromPr(pr),
        state: pr.state,
        mergedAt: pr.mergedAt,
        mergeCommitSha: pr.mergeCommit?.oid || null,
        url: pr.url,
        headRefName: pr.headRefName,
        headRefOid: pr.headRefOid,
        headRefShort: pr.headRefOid?.slice(0, 8) || null,
        baseRefName: pr.baseRefName,
        mainContainsMerge: mainMembership[index],
        isDraft: Boolean(pr.isDraft),
        mergeStateStatus: pr.mergeStateStatus || "UNKNOWN",
        updatedAt: pr.updatedAt,
        labels: (pr.labels || []).map((label) => label.name),
        checks: checkSummary(pr.statusCheckRollup || []),
      })),
    };
  } catch (error) {
    pullRequests = { available: false, count: null, items: [], error: safeToolError(error) };
  }

  const [linearRead, qaRead, workersRead, gitTodayRead, productionRead] = await Promise.allSettled([getSnap(force), readQaDifference(), readWorkers(), readTodayGit(), productionPromise]);
  const issues = linearRead.status === "fulfilled" ? (linearRead.value.issues || []) : null;
  const qaDifference = qaRead.status === "fulfilled" ? qaRead.value : { available: false, value: null, measuredAt: new Date().toISOString(), ttlMs: QA_TTL };
  const workers = workersRead.status === "fulfilled" ? workersRead.value : { available: false, items: [], measuredAt: new Date().toISOString() };
  const gitToday = gitTodayRead.status === "fulfilled" ? gitTodayRead.value : null;
  const measuredIssues = issues || [];
  const production = productionRead.status === "fulfilled" ? productionRead.value : { available: false, items: [], loginStatus: null, measuredAt: new Date().toISOString() };
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const prsByCard = new Map();
  for (const pr of pullRequests.items || []) {
    const cardId = pr.cardId;
    if (cardId && !prsByCard.has(cardId)) prsByCard.set(cardId, pr);
  }
  const deliveryIds = new Set(measuredIssues.filter((issue) => issue.status === "In Progress").map((issue) => issue.id));
  for (const pr of pullRequests.items || []) {
    if (pr.cardId && (pr.state === "OPEN" || (pr.mergedAt && new Date(pr.mergedAt).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }) === today))) deliveryIds.add(pr.cardId);
  }
  deliveryIds.delete("BBE-170"); // aggregate QA parent; child/release cards carry delivery evidence
  const deliveryRows = measuredIssues.filter((issue) => deliveryIds.has(issue.id)).map((issue) => ({ issue, pr: prsByCard.get(issue.id) || null }));
  const canReadLinearComments = linearRead.status === "fulfilled" && linearRead.value.available !== false;
  const commentEvidence = canReadLinearComments
    ? await within(readDeliveryCommentEvidence(deliveryRows, force), 5_000, () => cachedDeliveryCommentEvidence(deliveryRows))
    : cachedDeliveryCommentEvidence(deliveryRows);
  const deliveryItems = deliveryRows.map(({ issue, pr }) => {
    const deployment = pr?.mergeCommitSha ? production.items.find((item) => item.sha === pr.mergeCommitSha) || null : null;
    return { cardId: issue.id, linearStatus: issue.status, pr, deployment, ...classifyDelivery({ issue, pr, deployment, loginStatus: production.loginStatus, commentEvidence: commentEvidence.get(issue.id) }) };
  });
  const delivery = {
    available: Boolean(issues && issues.length && pullRequests.available && production.available),
    stale: Boolean(linearRead.status === "fulfilled" && linearRead.value.stale),
    linearAvailable: Boolean(linearRead.status === "fulfilled" && linearRead.value.available !== false),
    linearLastSuccessAt: linearRead.status === "fulfilled" ? linearRead.value.lastSuccessAt || null : snap.data?.lastSuccessAt || null,
    linearError: linearRead.status === "fulfilled" ? linearRead.value.error || null : linearReadFailure(linearRead.reason),
    measuredAt: new Date().toISOString(),
    loginStatus: production.loginStatus,
    items: deliveryItems,
    hostedRequiredCount: deliveryItems.filter((item) => item.hostedRequired).length,
    counts: Object.fromEntries(Object.values(DELIVERY_STAGE).map((stage) => [stage, deliveryItems.filter((item) => item.stage === stage).length])),
  };
  const completed = deliveryItems.filter((item) => item.complete).length;
  const globalLinearCompletion = terminalIssueCompletion(measuredIssues);
  const handNeeded = issues && measuredIssues.filter(isHandNeeded)
    .sort((a, b) => ({ Urgent: 0, High: 1, Medium: 2, Low: 3 }[a.priority?.name] ?? 4) - ({ Urgent: 0, High: 1, Medium: 2, Low: 3 }[b.priority?.name] ?? 4));
  const linearToday = measuredIssues.filter((issue) => new Date(issue.updatedAt).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }) === today)
    .map((issue) => ({ type: "linear", id: issue.id, at: issue.updatedAt, title: issue.title }));
  const todayItems = gitToday === null ? null : [...linearToday, ...gitToday].sort((a, b) => new Date(b.at) - new Date(a.at));
  return {
    builtAt: new Date().toISOString(), repository, pullRequests, production, delivery, workers, fuel: readFuel(),
    linear: {
      available: Boolean(linearRead.status === "fulfilled" && linearRead.value.available !== false),
      stale: Boolean(linearRead.status !== "fulfilled" || linearRead.value.stale),
      lastSuccessAt: linearRead.status === "fulfilled" ? linearRead.value.lastSuccessAt || null : snap.data?.lastSuccessAt || null,
      error: linearRead.status === "fulfilled" ? linearRead.value.error || null : linearReadFailure(linearRead.reason),
    },
    metrics: {
      qaDifference,
      urgentRemaining: issues ? measuredIssues.filter((issue) => issue.priority?.name === "Urgent" && !["Done", "Canceled", "Duplicate"].includes(issue.status)).length : null,
      handNeeded: handNeeded ? handNeeded.length : null,
      completion: delivery.available && deliveryItems.length ? { done: completed, total: deliveryItems.length, percent: Math.round(completed / deliveryItems.length * 100), basis: "production-bounded" } : null,
      linearCompletion: issues?.length ? globalLinearCompletion : null,
      todayProductionDone: delivery.available ? deliveryItems.filter((item) => item.complete && item.deployment?.updatedAt && new Date(item.deployment.updatedAt).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }) === today).length : null,
    },
    handNeeded, today: todayItems,
  };
}

async function getOperations(force = false) {
  if (!force && operationsSnap.data && Date.now() - operationsSnap.at < OPS_TTL) return operationsSnap.data;
  if (operationsSnap.building) return operationsSnap.building;
  operationsSnap.building = buildOperations(force).then((data) => {
    operationsSnap = { at: Date.now(), building: null, data };
    return data;
  }).catch((error) => {
    operationsSnap.building = null;
    throw error;
  });
  return operationsSnap.building;
}

function liveShim() {
  return `
<script>
/* ── 실시간 판 · 서버가 Linear 를 대신 읽는다 ──
   tools/board/board.template.html 과 «같은 파일» 이다.
   callMcpTool 만 이 서버의 /api 로 향하게 바꾼다. 렌더링 코드는 손대지 않는다. */
window.cowork = {
  async callMcpTool(tool, args){
    const wrap = (o) => ({ isError:false, structuredContent:o, content:[{ text: JSON.stringify(o) }] });
    const fail = (m) => ({ isError:true, content:[{ text:m }] });
    try{
      if (tool.endsWith("list_issues")){
        const r = await fetch("/api/issues" + (args.force ? "?force=1" : ""));
        if(!r.ok) return fail((await r.json()).message || ("HTTP "+r.status));
        return wrap(await r.json());
      }
      if (tool.endsWith("list_comments")){
        const r = await fetch("/api/comments?id=" + encodeURIComponent(args.issueId));
        if(!r.ok){
          const e = await r.json().catch(() => ({}));
          return fail(e.message || ("HTTP "+r.status));
        }
        return wrap(await r.json());
      }
      return wrap({});
    }catch(e){ return fail(String(e.message||e)); }
  }
};
</script>
<div style="max-width:1200px;margin:0 auto 4px;padding:9px 14px;border-radius:10px;
 background:#E7F7F3;border:1px solid #B9E6DC;color:#0F6E56;font:12px/1.5 -apple-system,Pretendard,sans-serif">
 <b>실시간 판이다.</b> 새로고침하면 지금의 Linear 를 읽는다 ·
 <span style="opacity:.75">서버 캐시 45초 · 키는 이 컴퓨터 밖으로 나가지 않는다</span>
</div>`;
}

/* ── HTTP ────────────────────────────────────────────────── */
const send = (res, code, body, type = "application/json; charset=utf-8") => {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
};
const NO_KEY = {
  error: "NO_AUTH",
  message: "GitHub 로그인을 찾지 못했다.",
  how: [
    "1. 터미널에서  gh auth login  을 실행한다 (GitHub.com · HTTPS · 브라우저 로그인)",
    "2. 끝나면 이 서버를 껐다 켠다 (Ctrl+C 후 다시 실행)",
    "※ 토큰을 어디에 붙여 넣을 필요는 없다 — 서버가 gh 에게 직접 물어본다.",
  ],
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (url.pathname === "/api/health")
      return send(res, 200, JSON.stringify({ keyPresent: AUTH_OK(), port: PORT, cachedAt: snap.at || null }));

    if (url.pathname === "/api/issues") {
      if (!AUTH_OK()) return send(res, 503, JSON.stringify(NO_KEY));
      const d = await getSnap(url.searchParams.get("force") === "1");
      return send(res, 200, JSON.stringify({ issues: d.issues, available: d.available, stale: d.stale, lastSuccessAt: d.lastSuccessAt, retryAt: d.error?.retryAt || null, error: d.error }));
    }

    if (url.pathname === "/api/operations") {
      try {
        return send(res, 200, JSON.stringify(await getOperations(url.searchParams.get("force") === "1")));
      } catch {
        return send(res, 502, JSON.stringify({
          error: "OPERATIONS_FAILED",
          message: "Git/GitHub 운영 상태를 읽지 못했습니다.",
        }));
      }
    }

    if (url.pathname === "/api/comments") {
      if (!AUTH_OK()) return send(res, 503, JSON.stringify(NO_KEY));
      const input = parseCommentRequest(url);
      if (input.error) return send(res, 400, JSON.stringify(input));
      try {
        return send(res, 200, JSON.stringify(await getComments(input.id, input.limit, input.after)));
      } catch {
        /* upstream 오류 원문에는 본문·식별 정보가 섞일 수 있으므로 반사하지 않는다. */
        return send(res, 502, JSON.stringify({
          error: "LINEAR_COMMENTS_FAILED",
          message: "Linear 댓글을 읽지 못했다.",
        }));
      }
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      if (!fs.existsSync(TEMPLATE))
        return send(res, 500, `<h3>템플릿이 없다</h3><p>${TEMPLATE}</p>`, "text/html; charset=utf-8");
      let html = fs.readFileSync(TEMPLATE, "utf8");
      if (!html.includes("<body>")) return send(res, 500, "템플릿에 &lt;body&gt; 가 없다", "text/html; charset=utf-8");
      html = html.replace("<body>", "<body>" + liveShim());
      html = html.replace(/<title>.*?<\/title>/, "<title>공동작업 관제판 : 신규리드·보드뷰·컬럼메뉴·대시보드 완주</title>");
      return send(res, 200, html, "text/html; charset=utf-8");
    }

    return send(res, 404, "not found", "text/plain; charset=utf-8");
  } catch (e) {
    return send(res, 502, JSON.stringify({ error: "LINEAR_FAILED", message: String(e.message || e) }));
  }
});

/* 호스트를 지정하지 않는다 — IPv4(127.0.0.1)와 IPv6(::1) 양쪽에서 열린다.
   "0.0.0.0" 으로 묶으면 크롬이 localhost 를 ::1 로 풀 때 연결이 거부된다. */
if (!ENV.DASHBOARD_NO_LISTEN) server.listen(PORT, () => {
  const L = "─".repeat(58);
  console.log(L);
  console.log("  모아워크 V6 관제판 — 실시간");
  console.log(L);
  console.log(`  이 컴퓨터    http://localhost:${PORT}`);
  console.log(`  다른 기기    http://<tailnet 주소>:${PORT}`);
  console.log("");
  console.log(`  템플릿  tools/board/board.template.html  (정본 — 디자인은 여기만 고친다)`);
  console.log(AUTH_OK ? "  ✅ Linear 키 확인됨" : "  ⚠️  Linear 키 없음 — .env 의 LINEAR_API_KEY 를 채우고 다시 켜라");
  console.log(L);
  console.log("  끄려면 Ctrl+C");
  getOperations(true).catch(() => {});
});

export { classifyDelivery, isHandNeeded, linearReadFailure, mapWithConcurrency, parseDeliveryCommentEvidence, readDeliveryCommentEvidence, terminalIssueCompletion };
