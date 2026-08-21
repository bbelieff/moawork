import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import http from "node:http";

const cwd = import.meta.dirname.replace(/[\\/]tools$/, "");
const requests = [];
const commentCalls = new Map();
let upstream;
let dashboard;
let dashboardUrl;
let rateLimited = false;

const listen = (server, port = 0) => new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, "127.0.0.1", () => resolve(server.address().port));
});
const close = (server) => new Promise((resolve) => server.close(resolve));
const readJson = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};
const json = (res, code, value) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
};

function commentConnection(id) {
  if (id === "BBE-94") {
    return {
      nodes: [
        { id: "comment-b", createdAt: "2026-08-15T02:00:00.000Z", updatedAt: "2026-08-15T02:01:00.000Z", body: "done fixture b" },
        { id: "comment-old", createdAt: "2026-08-14T23:00:00.000Z", updatedAt: "2026-08-14T23:01:00.000Z", body: "done fixture old" },
        { id: "comment-a", createdAt: "2026-08-15T02:00:00.000Z", updatedAt: "2026-08-15T02:02:00.000Z", body: "done fixture a" },
      ],
      pageInfo: { hasNextPage: true, endCursor: "cursor-done" },
    };
  }
  if (id === "BBE-125") {
    return {
      nodes: [{ id: "comment-live", createdAt: "2026-08-15T01:00:00.000Z", updatedAt: "2026-08-15T01:00:00.000Z", body: "live fixture" }],
      pageInfo: { hasNextPage: false, endCursor: "cursor-live" },
    };
  }
  if (id === "BBE-SLOW") {
    return {
      nodes: [{ id: "comment-slow", createdAt: "2026-08-15T00:00:00.000Z", updatedAt: "2026-08-15T00:00:00.000Z", body: "slow fixture" }],
      pageInfo: { hasNextPage: false, endCursor: null },
    };
  }
  return { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };
}

before(async () => {
  upstream = http.createServer(async (req, res) => {
    const payload = await readJson(req);
    requests.push(payload);
    assert.equal(payload.query.includes("mutation"), false, "dashboard must issue read-only GraphQL");

    if (payload.variables?.id) {
      const id = payload.variables.id;
      commentCalls.set(id, (commentCalls.get(id) ?? 0) + 1);
      if (id === "BBE-ERR") {
        return json(res, 200, { errors: [{ message: "upstream private body lin_api_must_not_leak" }] });
      }
      if (id === "BBE-SLOW") await new Promise((resolve) => setTimeout(resolve, 80));
      return json(res, 200, { data: { issue: { comments: commentConnection(id) } } });
    }

    if (rateLimited) return json(res, 200, { errors: [{ message: "Rate limit exceeded. private lin_api_must_not_leak" }] });

    return json(res, 200, {
      data: {
        issues: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [{
            identifier: "BBE-125",
            title: "In Progress fixture",
            createdAt: "2026-08-14T01:00:00.000Z",
            updatedAt: "2026-08-15T01:00:00.000Z",
            url: "https://linear.app/example/BBE-125",
            state: { name: "In Progress" },
            priority: 2,
            labels: { nodes: [{ name: "fixture" }] },
          }],
        },
      },
    });
  });
  const upstreamPort = await listen(upstream);

  const probe = http.createServer();
  const dashboardPort = await listen(probe);
  await close(probe);
  dashboardUrl = `http://127.0.0.1:${dashboardPort}`;
  dashboard = spawn(process.execPath, ["tools/dashboard-server.mjs"], {
    cwd,
    env: {
      NODE_ENV: "test",
      LINEAR_API_KEY: "lin_api_fixture_only_not_a_secret",
      LINEAR_GRAPHQL_TEST_URL: `http://127.0.0.1:${upstreamPort}/graphql`,
      DASHBOARD_PORT: String(dashboardPort),
      DASHBOARD_OPERATIONS_TEST_FIXTURE: JSON.stringify({
        builtAt: "2026-08-15T03:00:00.000Z",
        repository: {
          available: true,
          branch: "codex/dashboard-test",
          originMain: "abcdef0123456789",
          originMainShort: "abcdef01",
          dirty: false,
          dirtyCount: 0,
          changes: [],
          ahead: 1,
          behind: 0,
        },
        pullRequests: {
          available: true,
          count: 1,
          items: [{ number: 187, title: "fixture", checks: { success: 3, failing: 0, pending: 0, total: 3 } }],
        },
        production: { available: true, loginStatus: 200, measuredAt: "2026-08-15T03:00:00.000Z", items: [] },
        delivery: {
          available: true,
          loginStatus: 200,
          measuredAt: "2026-08-15T03:00:00.000Z",
          counts: { WORK_REVIEW: 0, MERGE_WAITING: 1, DEPLOYMENT_WAITING: 0, PRODUCTION_COMPLETE: 0, HOSTED_WAITING: 0 },
          items: [{ cardId: "BBE-125", linearStatus: "Done", stage: "MERGE_WAITING", complete: false, blockers: ["LINEAR_DONE_WITHOUT_PRODUCTION"], pr: { number: 187, checks: { success: 3, failing: 0, pending: 0, total: 3 } } }],
        },
        workers: { available: true, staleAfterMs: 300000, items: [{ cardId: "BBE-256", engine: "DG", status: "dispatched", worktree: "C:/work/MoaWork", lastActivityAt: "2026-08-15T03:00:00.000Z", stalled: false }] },
        metrics: { qaDifference: { available: true, value: 35, measuredAt: "2026-08-15T03:00:00.000Z", ttlMs: 300000 }, urgentRemaining: 2, handNeeded: 1, completion: { done: 0, total: 1, percent: 0, basis: "production" } },
        handNeeded: [{ id: "BBE-1", title: "fixture", status: "Blocked", priority: { name: "Urgent" } }],
        today: [{ type: "git", id: "abcdef01", at: "2026-08-15T03:00:00.000Z", title: "fixture commit" }],
        fuel: { available: false, claude: null, codex: null, updatedAt: null },
      }),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${dashboardUrl}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("dashboard test server did not start");
});

after(async () => {
  if (dashboard && !dashboard.killed) dashboard.kill();
  if (upstream) await close(upstream);
});

test("health remains available without exposing credentials", async () => {
  const response = await fetch(`${dashboardUrl}/api/health`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.keyPresent, true);
  assert.equal(JSON.stringify(body).includes("lin_api_"), false);
});

test("Done issue bypasses the active snapshot and returns the exact comment field contract", async () => {
  const response = await fetch(`${dashboardUrl}/api/comments?id=BBE-94`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(Object.keys(body.comments[0]).sort(), ["body", "createdAt", "id", "updatedAt"]);
  assert.deepEqual(body.comments.map((comment) => comment.id), ["comment-a", "comment-b", "comment-old"]);
  assert.deepEqual(body.pageInfo, { hasNextPage: true, endCursor: "cursor-done" });
  assert.equal(body.comments.map((comment) => comment.body).length, 3, "existing comments[].body consumer remains valid");
});

test("In Progress issue returns comments independently", async () => {
  const response = await fetch(`${dashboardUrl}/api/comments?id=BBE-125`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.comments.length, 1);
  assert.equal(body.comments[0].id, "comment-live");
});

test("limit defaults to 20, accepts boundaries, and forwards the after cursor", async () => {
  const defaultCursor = "default-limit-cursor";
  assert.equal((await fetch(`${dashboardUrl}/api/comments?id=BBE-EMPTY&after=${defaultCursor}`)).status, 200);
  assert.equal((await fetch(`${dashboardUrl}/api/comments?id=BBE-EMPTY&limit=1&after=one`)).status, 200);
  assert.equal((await fetch(`${dashboardUrl}/api/comments?id=BBE-EMPTY&limit=100&after=max`)).status, 200);
  assert.equal((await fetch(`${dashboardUrl}/api/comments?id=BBE-EMPTY&limit=0`)).status, 400);
  assert.equal((await fetch(`${dashboardUrl}/api/comments?id=BBE-EMPTY&limit=101`)).status, 400);
  assert.equal((await fetch(`${dashboardUrl}/api/comments?id=BBE-EMPTY&limit=1.5`)).status, 400);

  const calls = requests.filter((request) => request.variables?.id === "BBE-EMPTY");
  assert.deepEqual(calls.map((request) => [request.variables.first, request.variables.after]), [
    [20, defaultCursor], [1, "one"], [100, "max"],
  ]);
});

test("zero comments has a stable empty connection", async () => {
  const response = await fetch(`${dashboardUrl}/api/comments?id=BBE-NONE`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    comments: [],
    pageInfo: { hasNextPage: false, endCursor: null },
  });
});

test("same issue page cache and in-flight requests coalesce", async () => {
  const beforeCount = commentCalls.get("BBE-SLOW") ?? 0;
  const url = `${dashboardUrl}/api/comments?id=BBE-SLOW&after=coalesce`;
  const responses = await Promise.all([fetch(url), fetch(url), fetch(url)]);
  assert.deepEqual(responses.map((response) => response.status), [200, 200, 200]);
  assert.equal((commentCalls.get("BBE-SLOW") ?? 0) - beforeCount, 1);
  assert.equal((await fetch(url)).status, 200);
  assert.equal((commentCalls.get("BBE-SLOW") ?? 0) - beforeCount, 1, "short cache prevents a duplicate upstream read");
});

test("Linear errors return a safe 502 instead of an empty array or upstream details", async () => {
  const response = await fetch(`${dashboardUrl}/api/comments?id=BBE-ERR`);
  assert.equal(response.status, 502);
  const text = await response.text();
  assert.deepEqual(JSON.parse(text), {
    error: "LINEAR_COMMENTS_FAILED",
    message: "Linear 댓글을 읽지 못했다.",
  });
  assert.equal(text.includes("private body"), false);
  assert.equal(text.includes("lin_api_"), false);
});

test("missing id is rejected before GraphQL", async () => {
  const response = await fetch(`${dashboardUrl}/api/comments`);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "MISSING_ID");
});

test("issues endpoint retains the existing 45-second snapshot contract", async () => {
  const commentsBefore = [...commentCalls.values()].reduce((total, count) => total + count, 0);
  const response = await fetch(`${dashboardUrl}/api/issues?force=1`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.issues.map((issue) => [issue.id, issue.status]), [["BBE-125", "In Progress"]]);
  assert.deepEqual(body.issues.map((issue) => [issue.createdAt, issue.url]), [[
    "2026-08-14T01:00:00.000Z",
    "https://linear.app/example/BBE-125",
  ]]);
  const commentsAfter = [...commentCalls.values()].reduce((total, count) => total + count, 0);
  assert.equal(commentsAfter, commentsBefore, "issue snapshot must not duplicate the direct comment reads");
});

test("rate-limited issue refresh returns the last success as an explicit safe stale snapshot", async () => {
  const callsBefore = requests.filter((request) => !request.variables?.id).length;
  rateLimited = true;
  const [response, concurrentResponse] = await Promise.all([
    fetch(`${dashboardUrl}/api/issues?force=1`),
    fetch(`${dashboardUrl}/api/issues?force=1`),
  ]);
  rateLimited = false;
  assert.equal(response.status, 200);
  assert.equal(concurrentResponse.status, 200);
  assert.equal(
    requests.filter((request) => !request.variables?.id).length - callsBefore,
    1,
    "simultaneous forced refreshes must share one upstream issue read",
  );
  const body = await response.json();
  assert.equal(body.available, false);
  assert.equal(body.stale, true);
  assert.equal(body.error.code, "LINEAR_RATE_LIMITED");
  assert.equal(body.issues[0].id, "BBE-125");
  assert.ok(body.lastSuccessAt);
  assert.ok(body.retryAt);
  assert.equal(JSON.stringify(body).includes("private"), false);
  assert.equal(JSON.stringify(body).includes("lin_api_"), false);
});

test("operations endpoint exposes read-only repository and PR decision signals", async () => {
  const response = await fetch(`${dashboardUrl}/api/operations?force=1`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.repository.originMainShort, "abcdef01");
  assert.equal(body.repository.dirty, false);
  assert.equal(body.pullRequests.count, 1);
  assert.deepEqual(body.pullRequests.items[0].checks, { success: 3, failing: 0, pending: 0, total: 3 });
  assert.deepEqual(body.workers.items[0], { cardId: "BBE-256", engine: "DG", status: "dispatched", worktree: "C:/work/MoaWork", lastActivityAt: "2026-08-15T03:00:00.000Z", stalled: false });
  assert.equal(body.metrics.qaDifference.value, 35);
  assert.equal(body.metrics.completion.percent, 0);
  assert.equal(body.metrics.completion.basis, "production");
  assert.equal(body.delivery.items[0].complete, false, "CI PASS plus Linear Done must not count as Production complete");
  assert.equal(body.delivery.counts.MERGE_WAITING, 1);
  assert.equal(body.fuel.available, false);
  assert.equal(JSON.stringify(body).includes("lin_api_"), false);
  assert.ok(JSON.stringify(body).length < 10_000, "bounded operations payload must not regress toward the measured 155KB response");
  const startedAt = Date.now();
  assert.equal((await fetch(`${dashboardUrl}/api/operations?force=1`)).status, 200);
  assert.ok(Date.now() - startedAt < 5_000, "forced fixture refresh remains bounded");
});

test("aggregate BBE-170 parent never becomes a delivery denominator", async () => {
  const source = await readFile(new URL("./dashboard-server.mjs", import.meta.url), "utf8");
  assert.match(source, /deliveryIds\.delete\("BBE-170"\)/);
});

test("Production evidence fails closed for runtime logs and non-main merges", async () => {
  const source = await readFile(new URL("./dashboard-server.mjs", import.meta.url), "utf8");
  assert.match(source, /pr\?\.baseRefName === "main"/);
  assert.match(source, /pr\?\.mainContainsMerge === true/);
  assert.match(source, /"merge-base", "--is-ancestor"/);
  assert.match(source, /deployment\?\.runtimeErrorCount \?\? \(commentEvidence\?\.runtimeZero \? 0 : null\)/);
  assert.doesNotMatch(source, /deployment\?\.state === "SUCCESS" \? 0 : null/);
  assert.match(source, /DASHBOARD_RUNTIME_EVIDENCE_JSON/);
  assert.match(source, /deployments\(first:100/);
  assert.match(source, /if \(!force && operationsSnap\.data/);
  assert.match(source, /readProductionEvidence\(force\)/);
});

test("39-card regression fixture accepts only exact durable runtime and hosted evidence", async () => {
  process.env.DASHBOARD_NO_LISTEN = "1";
  const { classifyDelivery, mapWithConcurrency, parseDeliveryCommentEvidence } = await import("./dashboard-server.mjs?unit=delivery-evidence");
  const mergeSha = "a".repeat(40);
  const comments = [{ body: `merge ${mergeSha}; Production exact READY; /login 200; runtime error/fatal 0; hosted migration applied; postflight PASS; customerDML0` }];
  assert.deepEqual(parseDeliveryCommentEvidence(comments, mergeSha), { runtimeZero: true, hostedApplied: true });
  assert.equal(parseDeliveryCommentEvidence([{ body: `Production exact ${mergeSha}; /login 200; runtime error0` }], mergeSha).runtimeZero, true);
  for (const unsafe of ["runtime error0 / fatal2", "runtime error 0; fatal 3", "runtime fatal0 / error2", "runtime error0 / fatal count 2", "runtime error0 / fatal code 2"]) {
    assert.equal(parseDeliveryCommentEvidence([{ body: `merge ${mergeSha}; ${unsafe}` }], mergeSha).runtimeZero, false);
  }
  assert.equal(parseDeliveryCommentEvidence([
    { body: `merge ${mergeSha}; runtime error0 / fatal0` },
    { body: `merge ${mergeSha}; runtime fatal 2` },
  ], mergeSha).runtimeZero, false);
  assert.deepEqual(parseDeliveryCommentEvidence([{ body: "Done; runtime error/fatal 0; hosted applied; postflight PASS; customerDML0" }], mergeSha), { runtimeZero: false, hostedApplied: false });
  assert.equal(parseDeliveryCommentEvidence([{ body: `merge ${mergeSha}; runtime errors 10` }], mergeSha).runtimeZero, false);
  const fixture = Array.from({ length: 39 }, (_, index) => index);
  assert.deepEqual(await mapWithConcurrency(fixture, 4, async (value) => value * 2), fixture.map((value) => value * 2));
  const verdict = classifyDelivery({
    issue: { status: "Done", labels: ["needs-hosted"] },
    pr: { baseRefName: "main", mergedAt: "2026-08-21T00:00:00Z", mergeCommitSha: mergeSha, mainContainsMerge: true },
    deployment: { state: "SUCCESS", sha: mergeSha, runtimeErrorCount: null },
    loginStatus: 200,
    commentEvidence: { runtimeZero: true, hostedApplied: true },
  });
  assert.equal(verdict.complete, true);
  assert.equal(verdict.stage, "PRODUCTION_COMPLETE");
  assert.equal(verdict.runtimeErrorCount, 0);
  assert.equal(verdict.hostedApplied, true);
});

test("60 forced refreshes retain complete evidence and refresh only changed incomplete rows", async () => {
  process.env.DASHBOARD_NO_LISTEN = "1";
  const { readDeliveryCommentEvidence } = await import("./dashboard-server.mjs?unit=rate-limit-evidence");
  const sha = "b".repeat(40);
  const row = { issue: { id: "BBE-RATE", updatedAt: "2026-08-21T00:00:00Z" }, pr: { mergeCommitSha: sha } };
  let calls = 0;
  const readComments = async () => {
    calls += 1;
    return { comments: [{ body: `merge ${sha}; runtime error/fatal 0` }] };
  };
  for (let index = 0; index < 60; index += 1) await readDeliveryCommentEvidence([row], true, readComments);
  assert.equal(calls, 1);
  await readDeliveryCommentEvidence([{ ...row, issue: { ...row.issue, updatedAt: "2026-08-21T00:01:00Z" } }], true, readComments);
  assert.equal(calls, 1, "complete exact-SHA evidence remains durable across unrelated updates");
  await readDeliveryCommentEvidence([{ issue: row.issue, pr: { mergeCommitSha: "c".repeat(40) } }], true, readComments);
  assert.equal(calls, 2, "only a new merge SHA gets one new evidence read");

  const pending = { issue: { id: "BBE-PENDING", updatedAt: "2026-08-21T00:00:00Z" }, pr: { mergeCommitSha: "d".repeat(40) } };
  const pendingReads = async () => ({ comments: calls++ < 3 ? [] : [{ body: `merge ${"d".repeat(40)}; runtime error0` }] });
  await readDeliveryCommentEvidence([pending], true, pendingReads);
  for (let index = 0; index < 60; index += 1) await readDeliveryCommentEvidence([pending], true, pendingReads);
  assert.equal(calls, 3, "unchanged incomplete evidence is not fanned out by force");
  const advanced = { ...pending, issue: { ...pending.issue, updatedAt: "2026-08-21T00:01:00Z" } };
  const refreshed = await readDeliveryCommentEvidence([advanced], true, pendingReads);
  assert.equal(calls, 4, "one Linear update refreshes one incomplete row");
  assert.equal(refreshed.get("BBE-PENDING").runtimeZero, true);

  const failed = { issue: { id: "BBE-FAILED", updatedAt: "2026-08-21T00:00:00Z" }, pr: { mergeCommitSha: "e".repeat(40) } };
  let failedCalls = 0;
  const unavailable = async () => { failedCalls += 1; throw new Error("rate limited"); };
  await readDeliveryCommentEvidence([failed], true, unavailable);
  const failedAdvanced = { ...failed, issue: { ...failed.issue, updatedAt: "2026-08-21T00:01:00Z" } };
  await readDeliveryCommentEvidence([failedAdvanced], true, unavailable);
  for (let index = 0; index < 60; index += 1) await readDeliveryCommentEvidence([failedAdvanced], true, unavailable);
  assert.equal(failedCalls, 2, "a failed refresh is negatively cached for the advanced issue snapshot");
});
