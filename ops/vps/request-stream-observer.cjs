"use strict";

const diagnosticsChannel = require("node:diagnostics_channel");
const { randomUUID } = require("node:crypto");

const CHANNEL_NAME = "http.server.request.start";
const TRACE_HEADER = "x-mw-trace-id";
const INSTALLED = Symbol.for("moawork.request-stream-observer.installed");

function hasHeader(headers, name) {
  return Object.prototype.hasOwnProperty.call(headers ?? {}, name);
}

function shouldObserve(request) {
  const headers = request.headers ?? {};
  const isDocument = headers["sec-fetch-dest"] === "document";
  const isRsc = hasHeader(headers, "rsc");
  const isAction = hasHeader(headers, "next-action");
  return isDocument || isRsc || isAction;
}

function replaceRawTraceHeader(request, traceId) {
  if (Array.isArray(request.rawHeaders)) {
    const sanitized = [];
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      const name = request.rawHeaders[index];
      const value = request.rawHeaders[index + 1];
      if (String(name).toLowerCase() !== TRACE_HEADER) sanitized.push(name, value);
    }
    sanitized.push(TRACE_HEADER, traceId);
    request.rawHeaders.splice(0, request.rawHeaders.length, ...sanitized);
  }
  request.headers[TRACE_HEADER] = traceId;
}

function forceResponseTraceHeader(args, traceId) {
  const headerIndex = typeof args[1] === "string" ? 2 : 1;
  const headers = args[headerIndex];
  if (Array.isArray(headers)) {
    const sanitized = [];
    for (let index = 0; index < headers.length; index += 2) {
      if (String(headers[index]).toLowerCase() !== TRACE_HEADER) {
        sanitized.push(headers[index], headers[index + 1]);
      }
    }
    sanitized.push(TRACE_HEADER, traceId);
    args[headerIndex] = sanitized;
  } else if (headers && typeof headers === "object") {
    const sanitized = {};
    for (const [name, value] of Object.entries(headers)) {
      if (name.toLowerCase() !== TRACE_HEADER) sanitized[name] = value;
    }
    sanitized[TRACE_HEADER] = traceId;
    args[headerIndex] = sanitized;
  }
}

function elapsedMilliseconds(startedAt) {
  return Math.round(Number(process.hrtime.bigint() - startedAt) / 100_000) / 10;
}

function responseStatusClass(response) {
  const status = Number(response.statusCode);
  return Number.isInteger(status) && status >= 100 && status <= 599
    ? `${Math.floor(status / 100)}xx`
    : "unknown";
}

function chunkBytes(chunk, encoding) {
  if (chunk === undefined || chunk === null) return 0;
  if (typeof chunk === "string") return Buffer.byteLength(chunk, encoding);
  if (Buffer.isBuffer(chunk) || ArrayBuffer.isView(chunk)) return chunk.byteLength;
  return 0;
}

function emit(record) {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

function observe(request, response) {
  if (!shouldObserve(request)) return;

  const traceId = randomUUID();
  const startedAt = process.hrtime.bigint();
  let firstByteMilliseconds = null;
  let bodyBytes = 0;
  let terminalEmitted = false;

  replaceRawTraceHeader(request, traceId);
  response.setHeader(TRACE_HEADER, traceId);

  const markFirstByte = () => {
    if (firstByteMilliseconds !== null) return;
    if (!response.headersSent) response.setHeader(TRACE_HEADER, traceId);
    firstByteMilliseconds = elapsedMilliseconds(startedAt);
    emit({
      event: "mw.request_stream",
      phase: "first_byte",
      trace_id: traceId,
      elapsed_ms: firstByteMilliseconds,
      status_class: responseStatusClass(response),
    });
  };

  const markTerminal = (phase) => {
    if (terminalEmitted) return;
    terminalEmitted = true;
    emit({
      event: "mw.request_stream",
      phase,
      trace_id: traceId,
      elapsed_ms: elapsedMilliseconds(startedAt),
      first_byte_ms: firstByteMilliseconds,
      status_class: responseStatusClass(response),
      node_body_bytes: bodyBytes,
    });
  };

  for (const method of ["writeHead", "flushHeaders"]) {
    if (typeof response[method] !== "function") continue;
    const original = response[method];
    response[method] = function wrappedHeaderMethod(...args) {
      if (!response.headersSent) response.setHeader(TRACE_HEADER, traceId);
      if (method === "writeHead") forceResponseTraceHeader(args, traceId);
      const result = Reflect.apply(original, this, args);
      markFirstByte();
      return result;
    };
  }

  const originalWrite = response.write;
  response.write = function wrappedWrite() {
    bodyBytes += chunkBytes(arguments[0], arguments[1]);
    markFirstByte();
    return Reflect.apply(originalWrite, this, arguments);
  };

  const originalEnd = response.end;
  response.end = function wrappedEnd() {
    bodyBytes += chunkBytes(arguments[0], arguments[1]);
    markFirstByte();
    return Reflect.apply(originalEnd, this, arguments);
  };

  response.once("finish", () => markTerminal("finish"));
  response.once("close", () => {
    if (!response.writableFinished) markTerminal("premature_close");
  });
}

if (!globalThis[INSTALLED]) {
  globalThis[INSTALLED] = true;
  diagnosticsChannel.subscribe(CHANNEL_NAME, ({ request, response }) => {
    try {
      observe(request, response);
    } catch {
      // Per-request observer failures must never alter application behavior.
    }
  });
}
