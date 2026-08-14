import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawn } from "node:child_process";
import http from "node:http";

const cwd = import.meta.dirname.replace(/[\\/]tools$/, "");
const requests = [];
const commentCalls = new Map();
let upstream;
let dashboard;
let dashboardUrl;

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

test("operations endpoint exposes read-only repository and PR decision signals", async () => {
  const response = await fetch(`${dashboardUrl}/api/operations`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.repository.originMainShort, "abcdef01");
  assert.equal(body.repository.dirty, false);
  assert.equal(body.pullRequests.count, 1);
  assert.deepEqual(body.pullRequests.items[0].checks, { success: 3, failing: 0, pending: 0, total: 3 });
  assert.equal(JSON.stringify(body).includes("lin_api_"), false);
});
