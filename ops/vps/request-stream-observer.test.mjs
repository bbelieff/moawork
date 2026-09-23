import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { request as requestHttp } from "node:http";
import { connect } from "node:net";
import { fileURLToPath } from "node:url";
import test from "node:test";

const observer = fileURLToPath(new URL("./request-stream-observer.cjs", import.meta.url));
const SENTINELS = ["ATTACKER_TRACE", "ATTACKER_START", "customer@example.invalid", "org-secret", "board-secret", "cookie-secret"];

function runFixture() {
  const fixture = String.raw`
    const { createServer } = require("node:http");
    const server = createServer((request, response) => {
      if (request.url === "/stream") {
        response.setHeader("x-seen-trace", request.headers["x-mw-trace-id"] ?? "missing");
        response.setHeader("x-mw-trace-id", "ATTACKER_TRACE");
        const headReturn = response.writeHead(429);
        let writeCallback = false;
        const writeReturn = response.write("alpha", () => { writeCallback = true; });
        setTimeout(() => {
          const endReturn = response.end("beta", () => {
            process.send({ fixture: "semantics", headReturn: headReturn === response,
              writeReturnType: typeof writeReturn, endReturn: endReturn === response, writeCallback,
              requestStart: request.headers["x-mw-request-start-ms"] });
          });
        }, 5);
        return;
      }
      if (request.url === "/flush") {
        response.statusCode = 429;
        response.setHeader("x-seen-trace", request.headers["x-mw-trace-id"] ?? "missing");
        response.setHeader("x-mw-trace-id", "ATTACKER_TRACE");
        const flushReturn = response.flushHeaders();
        process.send({ fixture: "flush-semantics", flushReturnType: typeof flushReturn });
        response.end("flushed");
        return;
      }
      if (request.url.startsWith("/spoof")) {
        let body = "";
        request.on("data", (chunk) => { body += chunk; });
        request.on("end", () => {
          response.setHeader("x-seen-trace", request.headers["x-mw-trace-id"] ?? "missing");
          process.send({ fixture: "spoof-marker", requestStart: request.headers["x-mw-request-start-ms"] });
          response.end("accepted");
        });
        return;
      }
      if (request.url === "/document") {
        response.end();
        return;
      }
      if (request.url === "/abort") {
        response.write("partial");
        setTimeout(() => response.end("late"), 100);
        return;
      }
      response.end("static");
    });
    server.listen(0, "127.0.0.1", () => {
      process.stdout.write(JSON.stringify({ fixture: "ready", port: server.address().port }) + "\n");
    });
    process.on("message", (message) => { if (message === "close") server.close(() => process.exit(0)); });
  `;
  return spawn(process.execPath, ["--require", observer, "-e", fixture], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
  });
}

function httpCall(port, { path, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const request = requestHttp({ hostname: "127.0.0.1", port, path, method: body ? "POST" : "GET", headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        statusCode: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.on("error", reject);
    if (body) request.end(body); else request.end();
  });
}

function abortCall(port) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => {
      socket.write("GET /abort HTTP/1.1\r\nHost: 127.0.0.1\r\nrsc: 1\r\nConnection: close\r\n\r\n");
    });
    socket.once("data", () => socket.destroy());
    socket.once("close", resolve);
    socket.once("error", reject);
  });
}

function waitFor(predicate, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const value = predicate();
      if (value) {
        clearInterval(timer);
        resolve(value);
      } else if (Date.now() - started > timeout) {
        clearInterval(timer);
        reject(new Error("timed out waiting for observer output"));
      }
    }, 10);
  });
}

test("preload preserves responses, replaces spoofed traces, and emits bounded PII-free stream phases", async () => {
  const child = runFixture();
  let stdout = "";
  let stderr = "";
  const childMessages = [];
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  child.on("message", (message) => { childMessages.push(message); });

  const ready = await waitFor(() => {
    for (const line of stdout.split("\n")) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.fixture === "ready") return parsed;
      } catch {}
    }
    return null;
  });

  const stream = await httpCall(ready.port, { path: "/stream", headers: { rsc: "1" } });
  assert.equal(stream.statusCode, 429);
  assert.equal(stream.body, "alphabeta");
  assert.match(stream.headers["x-mw-trace-id"], /^[0-9a-f-]{36}$/);
  assert.equal(stream.headers["x-mw-trace-id"], stream.headers["x-seen-trace"]);
  assert.equal(stream.headers["x-mw-request-start-ms"], undefined);
  const semantics = await waitFor(() => childMessages.find((message) => message.fixture === "semantics"));
  assert.deepEqual({ ...semantics, requestStart: undefined }, {
    fixture: "semantics",
    headReturn: true,
    writeReturnType: "boolean",
    endReturn: true,
    writeCallback: true,
    requestStart: undefined,
  });
  assert.match(semantics.requestStart, /^\d+(?:\.\d+)?$/);

  const flushed = await httpCall(ready.port, { path: "/flush", headers: { rsc: "1" } });
  assert.equal(flushed.statusCode, 429);
  assert.equal(flushed.body, "flushed");
  assert.match(flushed.headers["x-mw-trace-id"], /^[0-9a-f-]{36}$/);
  assert.equal(flushed.headers["x-mw-trace-id"], flushed.headers["x-seen-trace"]);
  const flushSemantics = await waitFor(() => childMessages.find((message) => message.fixture === "flush-semantics"));
  assert.deepEqual(flushSemantics, { fixture: "flush-semantics", flushReturnType: "undefined" });

  const spoof = await httpCall(ready.port, {
    path: "/spoof?customer=customer@example.invalid&org=org-secret",
    headers: {
      "next-action": "action-id-must-not-log",
      "x-mw-trace-id": "ATTACKER_TRACE",
      "x-mw-request-start-ms": "ATTACKER_START",
      cookie: "session=cookie-secret",
      "x-board-id": "board-secret",
    },
    body: "customer@example.invalid org-secret board-secret",
  });
  assert.equal(spoof.statusCode, 200);
  assert.match(spoof.headers["x-seen-trace"], /^[0-9a-f-]{36}$/);
  assert.notEqual(spoof.headers["x-seen-trace"], "ATTACKER_TRACE");
  assert.equal(spoof.headers["x-mw-trace-id"], spoof.headers["x-seen-trace"]);
  assert.equal(spoof.headers["x-mw-request-start-ms"], undefined);
  const spoofMarker = await waitFor(() => childMessages.find((message) => message.fixture === "spoof-marker"));
  assert.match(spoofMarker.requestStart, /^\d+(?:\.\d+)?$/);
  assert.notEqual(spoofMarker.requestStart, "ATTACKER_START");

  const document = await httpCall(ready.port, { path: "/document", headers: { "sec-fetch-dest": "document" } });
  assert.equal(document.statusCode, 200);
  assert.equal(document.body, "");

  const staticAsset = await httpCall(ready.port, { path: "/asset.js" });
  assert.equal(staticAsset.statusCode, 200);
  assert.equal(staticAsset.body, "static");
  assert.equal(staticAsset.headers["x-mw-trace-id"], undefined);

  await abortCall(ready.port);
  const records = await waitFor(() => {
    const parsed = stdout.split("\n").flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    }).filter((entry) => entry.event === "mw.request_stream");
    return parsed.some((entry) => entry.phase === "premature_close") && parsed.length >= 10 ? parsed : null;
  });

  const byTrace = Map.groupBy(records, (entry) => entry.trace_id);
  assert.equal(byTrace.size, 5, JSON.stringify(records));
  for (const entries of byTrace.values()) {
    assert.equal(entries.filter((entry) => entry.phase === "first_byte").length, 1);
    assert.equal(entries.filter((entry) => entry.phase === "finish" || entry.phase === "premature_close").length, 1);
    assert.ok(entries[1].elapsed_ms >= entries[0].elapsed_ms);
    assert.ok(entries[1].last_write_ms >= entries[0].elapsed_ms);
    assert.ok(entries[1].elapsed_ms >= entries[1].last_write_ms);
    assert.ok(Number.isInteger(entries[1].chunk_count));
    assert.ok(entries[1].chunk_count >= 0);
    assert.ok(entries[1].max_inter_chunk_gap_ms >= 0);
    assert.equal(Object.hasOwn(entries[0], "path"), false);
    assert.equal(Object.hasOwn(entries[0], "method"), false);
  }
  const streamRows = byTrace.get(stream.headers["x-mw-trace-id"]);
  assert.equal(streamRows.at(-1).node_body_bytes, Buffer.byteLength("alphabeta"));
  assert.equal(streamRows.at(-1).chunk_count, 2);
  assert.ok(streamRows.at(-1).max_inter_chunk_gap_ms > 0);
  assert.equal(streamRows[0].status_class, "4xx");
  assert.equal(streamRows.at(-1).status_class, "4xx");
  const flushRows = byTrace.get(flushed.headers["x-mw-trace-id"]);
  assert.equal(flushRows[0].status_class, "4xx");
  assert.equal(flushRows.at(-1).status_class, "4xx");

  for (const sentinel of SENTINELS) assert.equal(stdout.includes(sentinel), false, sentinel);
  assert.equal(stderr, "");

  child.send("close");
  await new Promise((resolve, reject) => {
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`fixture exited ${code}`)));
  });
});
