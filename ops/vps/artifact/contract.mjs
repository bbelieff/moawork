import { createHash, createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { finished } from "node:stream/promises";

const TAR_BLOCK_BYTES = 512;
const TAR_END_BYTES = TAR_BLOCK_BYTES * 2;
const COPY_BUFFER_BYTES = 64 * 1024;
const SHA256_RE = /^[0-9a-f]{64}$/;
const GIT_SHA_RE = /^[0-9a-f]{40}$/;
const SAFE_RUNTIME_ROOT = "runtime";
const MANIFEST_KEYS = ["archive", "artifactKind", "assurance", "build", "builder", "payload", "schema", "source"];
const SOURCE_KEYS = ["commit", "lockSha256", "tree"];
const BUILDER_KEYS = ["arch", "nodeVersion", "npmVersion", "platform"];
const BUILD_KEYS = ["serverActionsKeyFingerprint"];
const PAYLOAD_KEYS = ["entries", "entriesSha256", "entryCount", "root", "services"];
const ARCHIVE_KEYS = ["bytes", "file", "format", "sha256"];
const ASSURANCE_KEYS = ["builderTrustVerified", "linuxAbiVerified", "signed", "transportIntegrityOnly"];
const ENTRY_KEYS = ["mode", "path", "sha256", "size", "type"];
const DIRECTORY_ENTRY_KEYS = ["mode", "path", "size", "type"];
const SERVICE_KEYS = ["payloadRoot", "serviceKey"];
const SECRET_BASENAME_RE = /^(?:\.env(?:\..+)?|\.npmrc|\.netrc|credentials|credentials\.json|secrets?\.json|id_rsa|id_ed25519)$/i;
const SECRET_EXTENSION_RE = /\.(?:key|pem|p12|pfx|jks|keystore)$/i;
const SECRET_CONTENT_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:^|[\r\n])\s*(?:SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|POSTGRES_PASSWORD|NEXT_SERVER_ACTIONS_ENCRYPTION_KEY|PRIVATE_KEY|SECRET_KEY|API_TOKEN|ACCESS_TOKEN)\s*=/,
];
const SECRET_CONFIG_EXTENSION_RE = /\.(?:json|ya?ml|toml|ini|properties|conf|config)$/i;
const SECRET_CONFIG_KEY_RE = /(?:^|[\r\n{,])\s*["']?(?:client_secret|clientSecret|aws_secret_access_key|aws_session_token|database_url|postgres_password|supabase_service_role_key|next_server_actions_encryption_key|private_key|secret_key|api_token|access_token|github_token|stripe_secret_key)["']?\s*[:=]/i;

export class ArtifactContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ArtifactContractError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new ArtifactContractError(code, message);
}

function exactKeys(value, expected, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code, "expected an object");
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(code, "object keys do not match the artifact contract");
  }
}

function assertHex(value, regex, code) {
  if (typeof value !== "string" || !regex.test(value)) fail(code, "digest or source identity is malformed");
}

function assertSafeInteger(value, code) {
  if (!Number.isSafeInteger(value) || value < 0) fail(code, "numeric manifest field is malformed");
}

function isOutsideRelativePath(relative) {
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function serverActionsFingerprint(value) {
  if (typeof value !== "string" || value !== value.trim() || /\s/u.test(value)) {
    fail("SERVER_ACTIONS_BUILD_KEY", "built Server Actions key is malformed");
  }
  const key = Buffer.from(value, "base64");
  if (![16, 24, 32].includes(key.length) || key.toString("base64") !== value) {
    fail("SERVER_ACTIONS_BUILD_KEY", "built Server Actions key is malformed");
  }
  return createHmac("sha256", key)
    .update("moawork:server-actions:fingerprint:v1")
    .digest("hex");
}

async function sha256File(filePath) {
  const digest = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(filePath)) {
    digest.update(chunk);
    bytes += chunk.length;
  }
  return { sha256: digest.digest("hex"), bytes };
}

function assertCanonicalArchivePath(value, code = "UNSAFE_ARCHIVE_PATH") {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") || value.includes("\\")) {
    fail(code, "archive path is not canonical POSIX text");
  }
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value)) fail(code, "absolute archive paths are forbidden");
  if (path.posix.normalize(value) !== value || value.split("/").some((part) => part === "" || part === "." || part === "..")) {
    fail(code, "archive traversal or non-canonical components are forbidden");
  }
  if (value !== SAFE_RUNTIME_ROOT && !value.startsWith(`${SAFE_RUNTIME_ROOT}/`)) {
    fail(code, "archive entries must stay below runtime");
  }
  if (Buffer.byteLength(value) > 255) fail(code, "archive path exceeds the ustar bound");
  return value;
}

function assertNoSecretName(archivePath) {
  const basename = path.posix.basename(archivePath);
  if (SECRET_BASENAME_RE.test(basename) || SECRET_EXTENSION_RE.test(basename)) {
    fail("RUNTIME_SECRET_FILE", "runtime secret or environment files are forbidden");
  }
}

function scanSecretText(text, archivePath) {
  if (SECRET_CONTENT_PATTERNS.some((pattern) => pattern.test(text))) {
    fail("RUNTIME_SECRET_CONTENT", "runtime artifact contains secret-shaped configuration");
  }
  if (SECRET_CONFIG_EXTENSION_RE.test(archivePath) && SECRET_CONFIG_KEY_RE.test(text)) {
    fail("RUNTIME_SECRET_CONTENT", "runtime artifact contains a credential-shaped configuration key");
  }
}

async function hashAndScanFile(filePath, archivePath) {
  const digest = createHash("sha256");
  let tail = "";
  let size = 0;
  for await (const chunk of createReadStream(filePath)) {
    digest.update(chunk);
    size += chunk.length;
    const text = tail + chunk.toString("latin1");
    scanSecretText(text, archivePath);
    tail = text.slice(-256);
  }
  return { sha256: digest.digest("hex"), size };
}

function normalizeMode(stats, type) {
  if (type === "directory") return 0o755;
  return (stats.mode & 0o111) === 0 ? 0o644 : 0o755;
}

function ensureMappedDirectory(entries, archivePath) {
  assertCanonicalArchivePath(archivePath);
  const existing = entries.get(archivePath);
  if (existing) {
    if (existing.type !== "directory") fail("DUPLICATE_ENTRY", "two payload inputs map to one archive entry");
    return;
  }
  entries.set(archivePath, { path: archivePath, type: "directory", mode: 0o755, size: 0, sourcePath: null });
}

function ensureParents(entries, archivePath) {
  const parts = archivePath.split("/");
  for (let index = 1; index < parts.length; index += 1) {
    ensureMappedDirectory(entries, parts.slice(0, index).join("/"));
  }
}

async function collectDirectory(entries, sourceRoot, mappedRoot) {
  const rootStats = await lstat(sourceRoot);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) fail("INPUT_DIRECTORY_TYPE", "artifact input must be a real directory");
  const realSourceRoot = await realpath(sourceRoot);
  ensureParents(entries, mappedRoot);
  ensureMappedDirectory(entries, mappedRoot);

  function requireInsideSource(candidate) {
    const relative = path.relative(realSourceRoot, candidate);
    if (isOutsideRelativePath(relative)) {
      fail("SYMLINK_OUTSIDE_ROOT", "artifact links must resolve inside their mapped input root");
    }
  }

  async function visit(sourceDirectory, archiveDirectory, activeDirectories) {
    const realDirectory = await realpath(sourceDirectory);
    requireInsideSource(realDirectory);
    if (activeDirectories.has(realDirectory)) fail("SYMLINK_CYCLE", "artifact input contains a directory link cycle");
    const nextActive = new Set(activeDirectories);
    nextActive.add(realDirectory);
    const children = await readdir(sourceDirectory, { withFileTypes: true });
    children.sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)));
    for (const child of children) {
      const sourcePath = path.join(sourceDirectory, child.name);
      const archivePath = assertCanonicalArchivePath(`${archiveDirectory}/${child.name.split(path.sep).join("/")}`);
      const linkStats = await lstat(sourcePath);
      const resolvedSourcePath = linkStats.isSymbolicLink() ? await realpath(sourcePath) : sourcePath;
      if (linkStats.isSymbolicLink()) requireInsideSource(resolvedSourcePath);
      const stats = linkStats.isSymbolicLink() ? await stat(resolvedSourcePath) : linkStats;
      if (stats.isDirectory()) {
        ensureParents(entries, archivePath);
        ensureMappedDirectory(entries, archivePath);
        await visit(resolvedSourcePath, archivePath, nextActive);
        continue;
      }
      if (!stats.isFile()) fail("INPUT_FILE_TYPE", "artifact inputs may contain only regular files and directories");
      assertNoSecretName(archivePath);
      if (entries.has(archivePath)) fail("DUPLICATE_ENTRY", "two payload inputs map to one archive entry");
      const hashed = await hashAndScanFile(resolvedSourcePath, archivePath);
      entries.set(archivePath, {
        path: archivePath,
        type: "file",
        mode: normalizeMode(stats, "file"),
        size: hashed.size,
        sha256: hashed.sha256,
        sourcePath: resolvedSourcePath,
      });
    }
  }

  await visit(sourceRoot, mappedRoot, new Set());
}

function splitUstarPath(archivePath) {
  const bytes = Buffer.byteLength(archivePath);
  if (bytes <= 100) return { name: archivePath, prefix: "" };
  const separators = [...archivePath.matchAll(/\//g)].map((match) => match.index).reverse();
  for (const separator of separators) {
    const prefix = archivePath.slice(0, separator);
    const name = archivePath.slice(separator + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return { name, prefix };
  }
  fail("ARCHIVE_PATH_TOO_LONG", "archive path cannot be represented as ustar");
}

function writeField(buffer, offset, length, value) {
  const encoded = Buffer.from(value, "utf8");
  if (encoded.length > length) fail("TAR_HEADER_FIELD", "tar header field exceeds its bound");
  encoded.copy(buffer, offset);
}

function writeOctal(buffer, offset, length, value) {
  const encoded = value.toString(8).padStart(length - 1, "0");
  if (encoded.length > length - 1) fail("TAR_HEADER_NUMBER", "tar numeric field exceeds its bound");
  writeField(buffer, offset, length, `${encoded}\0`);
}

function tarHeader(entry) {
  const buffer = Buffer.alloc(TAR_BLOCK_BYTES, 0);
  const split = splitUstarPath(entry.path);
  writeField(buffer, 0, 100, split.name);
  writeOctal(buffer, 100, 8, entry.mode);
  writeOctal(buffer, 108, 8, 0);
  writeOctal(buffer, 116, 8, 0);
  writeOctal(buffer, 124, 12, entry.size);
  writeOctal(buffer, 136, 12, 0);
  buffer.fill(0x20, 148, 156);
  buffer[156] = entry.type === "directory" ? 0x35 : 0x30;
  writeField(buffer, 257, 6, "ustar\0");
  writeField(buffer, 263, 2, "00");
  writeField(buffer, 345, 155, split.prefix);
  const checksum = buffer.reduce((sum, byte) => sum + byte, 0);
  writeField(buffer, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return buffer;
}

async function writeChunk(stream, digest, chunk) {
  digest.update(chunk);
  if (!stream.write(chunk)) await new Promise((resolve) => stream.once("drain", resolve));
}

async function writeTar(entries, destination) {
  const stream = createWriteStream(destination, { flags: "wx", mode: 0o600 });
  const digest = createHash("sha256");
  let bytes = 0;
  try {
    for (const entry of entries) {
      const header = tarHeader(entry);
      await writeChunk(stream, digest, header);
      bytes += header.length;
      if (entry.type === "file") {
        const fileDigest = createHash("sha256");
        const handle = await open(entry.sourcePath, "r");
        try {
          const before = await handle.stat();
          if (!before.isFile() || before.size !== entry.size) fail("INPUT_CHANGED", "artifact input changed while packaging");
          const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
          let position = 0;
          while (position < entry.size) {
            const length = Math.min(buffer.length, entry.size - position);
            const { bytesRead } = await handle.read(buffer, 0, length, position);
            if (bytesRead !== length) fail("INPUT_CHANGED", "artifact input became truncated while packaging");
            const chunk = buffer.subarray(0, bytesRead);
            fileDigest.update(chunk);
            await writeChunk(stream, digest, chunk);
            bytes += bytesRead;
            position += bytesRead;
          }
          const after = await handle.stat();
          if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || fileDigest.digest("hex") !== entry.sha256) {
            fail("INPUT_CHANGED", "artifact input changed while packaging");
          }
        } finally {
          await handle.close();
        }
        const padding = (TAR_BLOCK_BYTES - (entry.size % TAR_BLOCK_BYTES)) % TAR_BLOCK_BYTES;
        if (padding > 0) {
          const chunk = Buffer.alloc(padding, 0);
          await writeChunk(stream, digest, chunk);
          bytes += padding;
        }
      }
    }
    const ending = Buffer.alloc(TAR_END_BYTES, 0);
    await writeChunk(stream, digest, ending);
    bytes += ending.length;
    stream.end();
    await finished(stream);
    return { sha256: digest.digest("hex"), bytes };
  } catch (error) {
    stream.destroy();
    await finished(stream).catch(() => {});
    throw error;
  }
}

function git(repoPath, args) {
  return execFileSync("git", ["-C", repoPath, ...args], { encoding: "utf8", windowsHide: true }).trim();
}

function npmVersion() {
  try {
    const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npm";
    const args = process.platform === "win32" ? ["/d", "/s", "/c", "npm.cmd --version"] : ["--version"];
    const version = execFileSync(command, args, { encoding: "utf8", windowsHide: true }).trim();
    if (!version) fail("NPM_VERSION", "npm version could not be measured");
    return version;
  } catch (error) {
    if (error instanceof ArtifactContractError) throw error;
    fail("NPM_VERSION", "npm version could not be measured");
  }
}

async function assertRealPathInside(rootPath, childPath, type) {
  const root = await realpath(rootPath);
  const child = await realpath(childPath);
  const relative = path.relative(root, child);
  if (relative === "" && type !== "repository") fail("INPUT_OVERLAP", "artifact input cannot be the repository root");
  if (isOutsideRelativePath(relative)) fail("INPUT_OUTSIDE_REPOSITORY", "artifact inputs must stay inside the source repository");
  const childStats = await lstat(childPath);
  if (childStats.isSymbolicLink()) fail("INPUT_SYMLINK", "artifact input roots may not be symlinks or junctions");
  if (type === "directory" && !childStats.isDirectory()) fail("INPUT_DIRECTORY_TYPE", "artifact input must be a directory");
  if (type === "file" && !childStats.isFile()) fail("INPUT_FILE_TYPE", "artifact input must be a regular file");
  return child;
}

async function pathExists(target) {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function manifestEntry(entry) {
  if (entry.type === "directory") return { path: entry.path, type: entry.type, mode: entry.mode, size: 0 };
  return { path: entry.path, type: entry.type, mode: entry.mode, size: entry.size, sha256: entry.sha256 };
}

export async function packReleaseArtifact({ repoPath, standalonePath, staticPath, publicPath, archivePath, manifestPath }) {
  const resolvedRepo = path.resolve(repoPath);
  const resolvedArchive = path.resolve(archivePath);
  const resolvedManifest = path.resolve(manifestPath);
  if (resolvedArchive === resolvedManifest) fail("OUTPUT_COLLISION", "archive and manifest paths must differ");
  if (await pathExists(resolvedArchive) || await pathExists(resolvedManifest)) fail("OUTPUT_EXISTS", "artifact outputs are immutable and must not already exist");

  const repoStats = await lstat(resolvedRepo);
  if (!repoStats.isDirectory() || repoStats.isSymbolicLink()) fail("REPOSITORY_TYPE", "repository must be a real directory");
  const standalone = await assertRealPathInside(resolvedRepo, path.resolve(standalonePath), "directory");
  const staticRoot = await assertRealPathInside(resolvedRepo, path.resolve(staticPath), "directory");
  const publicRoot = await assertRealPathInside(resolvedRepo, path.resolve(publicPath), "directory");
  const lockPath = await assertRealPathInside(resolvedRepo, path.join(resolvedRepo, "package-lock.json"), "file");
  const trackedStatus = git(resolvedRepo, ["status", "--porcelain=v1", "--untracked-files=no"]);
  if (trackedStatus !== "") fail("SOURCE_DIRTY", "tracked source files must match the exact source commit");
  const sourceCommit = git(resolvedRepo, ["rev-parse", "HEAD"]);
  const sourceTree = git(resolvedRepo, ["show", "-s", "--format=%T", "HEAD"]);
  assertHex(sourceCommit, GIT_SHA_RE, "SOURCE_COMMIT");
  assertHex(sourceTree, GIT_SHA_RE, "SOURCE_TREE");
  const requiredServerFilesPath = await assertRealPathInside(
    resolvedRepo,
    path.join(standalone, "app", ".next", "required-server-files.json"),
    "file",
  );
  let requiredServerFiles;
  try {
    requiredServerFiles = JSON.parse(await readFile(requiredServerFilesPath, "utf8"));
  } catch (error) {
    fail("BUILD_IDENTITY", "standalone required-server-files metadata is malformed", error);
  }
  if (requiredServerFiles?.config?.deploymentId !== sourceCommit) {
    fail("BUILD_IDENTITY_MISMATCH", "standalone deployment identity must equal the exact source commit");
  }
  const serverActionsKeyFingerprint =
    requiredServerFiles?.config?.env?.MOAWORK_SERVER_ACTIONS_BUILD_FINGERPRINT;
  assertHex(serverActionsKeyFingerprint, SHA256_RE, "SERVER_ACTIONS_BUILD_FINGERPRINT");
  const serverReferenceManifestPath = await assertRealPathInside(
    resolvedRepo,
    path.join(standalone, "app", ".next", "server", "server-reference-manifest.json"),
    "file",
  );
  let serverReferenceManifest;
  try {
    serverReferenceManifest = JSON.parse(await readFile(serverReferenceManifestPath, "utf8"));
  } catch (error) {
    fail("SERVER_ACTIONS_BUILD_KEY", "built Server Actions manifest is malformed", error);
  }
  if (serverActionsFingerprint(serverReferenceManifest?.encryptionKey) !== serverActionsKeyFingerprint) {
    fail("SERVER_ACTIONS_BUILD_FINGERPRINT", "Next build did not consume the fingerprinted Server Actions key");
  }
  const lock = await sha256File(lockPath);

  const entries = new Map();
  await collectDirectory(entries, standalone, SAFE_RUNTIME_ROOT);
  await collectDirectory(entries, staticRoot, "runtime/app/.next/static");
  await collectDirectory(entries, publicRoot, "runtime/app/public");
  const serverEntry = entries.get("runtime/app/server.js");
  if (!serverEntry || serverEntry.type !== "file") fail("STANDALONE_ENTRYPOINT", "standalone payload must contain app/server.js");
  const orderedEntries = [...entries.values()].sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
  const publicEntries = orderedEntries.map(manifestEntry);
  const entriesSha256 = sha256Bytes(canonicalJson(publicEntries));

  await mkdir(path.dirname(resolvedArchive), { recursive: true });
  await mkdir(path.dirname(resolvedManifest), { recursive: true });
  const archiveTemp = path.join(path.dirname(resolvedArchive), `.${path.basename(resolvedArchive)}.${randomUUID()}.tmp`);
  const manifestTemp = path.join(path.dirname(resolvedManifest), `.${path.basename(resolvedManifest)}.${randomUUID()}.tmp`);
  let archiveInstalled = false;
  try {
    const archive = await writeTar(orderedEntries, archiveTemp);
    const manifest = {
      schema: 1,
      artifactKind: "next-standalone-tar",
      source: { commit: sourceCommit, tree: sourceTree, lockSha256: lock.sha256 },
      builder: {
        nodeVersion: process.version,
        npmVersion: npmVersion(),
        platform: process.platform,
        arch: process.arch,
      },
      build: { serverActionsKeyFingerprint },
      payload: {
        root: SAFE_RUNTIME_ROOT,
        entryCount: publicEntries.length,
        entriesSha256,
        entries: publicEntries,
        services: [{ serviceKey: "web", payloadRoot: SAFE_RUNTIME_ROOT }],
      },
      archive: { file: path.basename(resolvedArchive), format: "tar", bytes: archive.bytes, sha256: archive.sha256 },
      assurance: {
        transportIntegrityOnly: true,
        signed: false,
        builderTrustVerified: false,
        linuxAbiVerified: false,
      },
    };
    const manifestBytes = canonicalJson(manifest);
    await writeFile(manifestTemp, manifestBytes, { flag: "wx", mode: 0o600 });
    if (await pathExists(resolvedArchive) || await pathExists(resolvedManifest)) fail("OUTPUT_EXISTS", "artifact outputs appeared during packaging");
    await rename(archiveTemp, resolvedArchive);
    archiveInstalled = true;
    await rename(manifestTemp, resolvedManifest);
    return Object.freeze({
      schema: 1,
      releaseId: archive.sha256,
      sourceSha: sourceCommit,
      sourceTree,
      serverActionsKeyFingerprint,
      builder: Object.freeze({ ...manifest.builder }),
      assurance: Object.freeze({ ...manifest.assurance }),
      archivePath: resolvedArchive,
      archiveSha256: archive.sha256,
      manifestPath: resolvedManifest,
      manifestSha256: sha256Bytes(manifestBytes),
      services: Object.freeze([{ serviceKey: "web", payloadRoot: SAFE_RUNTIME_ROOT }]),
    });
  } catch (error) {
    await rm(archiveTemp, { force: true }).catch(() => {});
    await rm(manifestTemp, { force: true }).catch(() => {});
    if (archiveInstalled) await rm(resolvedArchive, { force: true }).catch(() => {});
    throw error;
  }
}

function parseOctal(buffer, offset, length, code) {
  const raw = buffer.subarray(offset, offset + length).toString("ascii").replace(/[\0 ]+$/g, "");
  if (!/^[0-7]+$/.test(raw)) fail(code, "tar numeric field is not canonical octal");
  const value = Number.parseInt(raw, 8);
  if (!Number.isSafeInteger(value) || value < 0) fail(code, "tar numeric field is unsafe");
  return value;
}

function readTarString(buffer, offset, length) {
  const field = buffer.subarray(offset, offset + length);
  const end = field.indexOf(0);
  return field.subarray(0, end < 0 ? field.length : end).toString("utf8");
}

function parseHeader(header) {
  const storedChecksum = parseOctal(header, 148, 8, "TAR_CHECKSUM");
  const copy = Buffer.from(header);
  copy.fill(0x20, 148, 156);
  const actualChecksum = copy.reduce((sum, byte) => sum + byte, 0);
  if (storedChecksum !== actualChecksum) fail("TAR_CHECKSUM", "tar header checksum mismatch");
  if (readTarString(header, 257, 6) !== "ustar" || readTarString(header, 263, 2) !== "00") {
    fail("TAR_FORMAT", "only canonical ustar archives are accepted");
  }
  const name = readTarString(header, 0, 100);
  const prefix = readTarString(header, 345, 155);
  const archivePath = assertCanonicalArchivePath(prefix ? `${prefix}/${name}` : name);
  assertNoSecretName(archivePath);
  const typeByte = header[156];
  const type = typeByte === 0x35 ? "directory" : typeByte === 0x30 || typeByte === 0 ? "file" : null;
  if (!type) fail("TAR_ENTRY_TYPE", "links and non-regular tar entries are forbidden");
  const mode = parseOctal(header, 100, 8, "TAR_MODE");
  const uid = parseOctal(header, 108, 8, "TAR_OWNER");
  const gid = parseOctal(header, 116, 8, "TAR_OWNER");
  const size = parseOctal(header, 124, 12, "TAR_SIZE");
  const mtime = parseOctal(header, 136, 12, "TAR_TIME");
  if (uid !== 0 || gid !== 0 || mtime !== 0) fail("TAR_METADATA", "tar ownership and time metadata must be normalized");
  if (type === "directory" && size !== 0) fail("TAR_DIRECTORY_SIZE", "tar directories must have zero size");
  if (mode !== (type === "directory" ? 0o755 : 0o644) && !(type === "file" && mode === 0o755)) {
    fail("TAR_MODE", "tar mode is outside the normalized artifact contract");
  }
  const entry = { path: archivePath, type, mode, size };
  if (!header.equals(tarHeader(entry))) fail("TAR_HEADER_CANONICAL", "tar header is not the canonical writer representation");
  return entry;
}

async function readExact(handle, buffer, position) {
  let offset = 0;
  while (offset < buffer.length) {
    const result = await handle.read(buffer, offset, buffer.length - offset, position + offset);
    if (result.bytesRead === 0) fail("TAR_TRUNCATED", "archive ended before a complete tar record");
    offset += result.bytesRead;
  }
}

function safeExtractPath(root, archivePath) {
  const resolved = path.resolve(root, ...archivePath.split("/"));
  const relative = path.relative(root, resolved);
  if (isOutsideRelativePath(relative)) fail("EXTRACT_TRAVERSAL", "extraction path escaped its staging root");
  return resolved;
}

async function parseTar(archivePath, extractRoot = null) {
  const archiveStats = await lstat(archivePath);
  if (!archiveStats.isFile() || archiveStats.isSymbolicLink()) fail("ARCHIVE_TYPE", "archive must be a regular non-symlink file");
  const handle = await open(archivePath, "r");
  const entries = [];
  const seen = new Set();
  let position = 0;
  try {
    while (position < archiveStats.size) {
      const header = Buffer.alloc(TAR_BLOCK_BYTES);
      await readExact(handle, header, position);
      position += TAR_BLOCK_BYTES;
      if (header.every((byte) => byte === 0)) {
        const second = Buffer.alloc(TAR_BLOCK_BYTES);
        await readExact(handle, second, position);
        position += TAR_BLOCK_BYTES;
        if (!second.every((byte) => byte === 0) || position !== archiveStats.size) {
          fail("TAR_END", "archive must end with exactly two zero records");
        }
        return entries;
      }
      const entry = parseHeader(header);
      if (seen.has(entry.path)) fail("DUPLICATE_ENTRY", "archive contains a duplicate entry path");
      seen.add(entry.path);
      const digest = createHash("sha256");
      let tail = "";
      let output = null;
      if (extractRoot) {
        const target = safeExtractPath(extractRoot, entry.path);
        if (entry.type === "directory") {
          await mkdir(target, { recursive: false, mode: entry.mode });
          await chmod(target, entry.mode);
        } else {
          output = await open(target, "wx", entry.mode);
        }
      }
      try {
        let remaining = entry.size;
        const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
        while (remaining > 0) {
          const length = Math.min(buffer.length, remaining);
          const chunk = buffer.subarray(0, length);
          await readExact(handle, chunk, position);
          position += length;
          remaining -= length;
          digest.update(chunk);
          const text = tail + chunk.toString("latin1");
          scanSecretText(text, entry.path);
          tail = text.slice(-256);
          if (output) await output.write(chunk);
        }
      } finally {
        if (output) await output.close();
      }
      const padding = (TAR_BLOCK_BYTES - (entry.size % TAR_BLOCK_BYTES)) % TAR_BLOCK_BYTES;
      if (padding > 0) {
        const padded = Buffer.alloc(padding);
        await readExact(handle, padded, position);
        if (!padded.every((byte) => byte === 0)) fail("TAR_PADDING", "tar payload padding must be zero");
        position += padding;
      }
      entries.push(entry.type === "file" ? { ...entry, sha256: digest.digest("hex") } : entry);
    }
    fail("TAR_END", "archive is missing its two terminating zero records");
  } finally {
    await handle.close();
  }
}

function validateManifest(manifest, archivePath) {
  exactKeys(manifest, MANIFEST_KEYS, "MANIFEST_KEYS");
  if (manifest.schema !== 1 || manifest.artifactKind !== "next-standalone-tar") fail("MANIFEST_SCHEMA", "unsupported artifact manifest");
  exactKeys(manifest.source, SOURCE_KEYS, "SOURCE_KEYS");
  assertHex(manifest.source.commit, GIT_SHA_RE, "SOURCE_COMMIT");
  assertHex(manifest.source.tree, GIT_SHA_RE, "SOURCE_TREE");
  assertHex(manifest.source.lockSha256, SHA256_RE, "LOCK_DIGEST");
  exactKeys(manifest.builder, BUILDER_KEYS, "BUILDER_KEYS");
  if (typeof manifest.builder.nodeVersion !== "string" || !/^v\d+\.\d+\.\d+/.test(manifest.builder.nodeVersion)) fail("NODE_VERSION", "builder Node version is malformed");
  if (typeof manifest.builder.npmVersion !== "string" || !/^\d+\.\d+\.\d+/.test(manifest.builder.npmVersion)) fail("NPM_VERSION", "builder npm version is malformed");
  if (typeof manifest.builder.platform !== "string" || !/^[a-z0-9_-]{2,32}$/.test(manifest.builder.platform)) fail("BUILDER_PLATFORM", "builder platform is malformed");
  if (typeof manifest.builder.arch !== "string" || !/^[a-z0-9_-]{2,32}$/.test(manifest.builder.arch)) fail("BUILDER_ARCH", "builder architecture is malformed");
  exactKeys(manifest.build, BUILD_KEYS, "BUILD_KEYS");
  assertHex(manifest.build.serverActionsKeyFingerprint, SHA256_RE, "SERVER_ACTIONS_BUILD_FINGERPRINT");
  exactKeys(manifest.assurance, ASSURANCE_KEYS, "ASSURANCE_KEYS");
  if (manifest.assurance.transportIntegrityOnly !== true || manifest.assurance.signed !== false || manifest.assurance.builderTrustVerified !== false || manifest.assurance.linuxAbiVerified !== false) {
    fail("ASSURANCE_OVERCLAIM", "artifact integrity must not be represented as signing, builder trust, or Linux ABI proof");
  }
  exactKeys(manifest.archive, ARCHIVE_KEYS, "ARCHIVE_KEYS");
  if (manifest.archive.file !== path.basename(archivePath) || manifest.archive.format !== "tar") fail("ARCHIVE_IDENTITY", "manifest names a different archive");
  assertSafeInteger(manifest.archive.bytes, "ARCHIVE_BYTES");
  assertHex(manifest.archive.sha256, SHA256_RE, "ARCHIVE_DIGEST");
  exactKeys(manifest.payload, PAYLOAD_KEYS, "PAYLOAD_KEYS");
  if (manifest.payload.root !== SAFE_RUNTIME_ROOT) fail("PAYLOAD_ROOT", "payload root must be runtime");
  assertSafeInteger(manifest.payload.entryCount, "ENTRY_COUNT");
  assertHex(manifest.payload.entriesSha256, SHA256_RE, "ENTRIES_DIGEST");
  if (!Array.isArray(manifest.payload.entries) || manifest.payload.entries.length !== manifest.payload.entryCount) fail("ENTRY_COUNT", "payload entry count mismatch");
  if (!Array.isArray(manifest.payload.services) || manifest.payload.services.length !== 1) fail("SERVICES", "artifact must contain exactly the web service");
  exactKeys(manifest.payload.services[0], SERVICE_KEYS, "SERVICE_KEYS");
  if (manifest.payload.services[0].serviceKey !== "web" || manifest.payload.services[0].payloadRoot !== SAFE_RUNTIME_ROOT) fail("SERVICES", "artifact service topology is not canonical");
  let previous = null;
  const seen = new Set();
  for (const entry of manifest.payload.entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail("ENTRY_SCHEMA", "payload entry is malformed");
    const type = entry.type;
    exactKeys(entry, type === "directory" ? DIRECTORY_ENTRY_KEYS : ENTRY_KEYS, "ENTRY_KEYS");
    assertCanonicalArchivePath(entry.path);
    assertNoSecretName(entry.path);
    if (previous !== null && Buffer.from(previous).compare(Buffer.from(entry.path)) >= 0) fail("ENTRY_ORDER", "payload entries must be sorted and unique");
    if (seen.has(entry.path)) fail("DUPLICATE_ENTRY", "manifest contains duplicate entry paths");
    seen.add(entry.path);
    previous = entry.path;
    if (type !== "file" && type !== "directory") fail("ENTRY_TYPE", "manifest entry type is unsupported");
    if (entry.mode !== (type === "directory" ? 0o755 : 0o644) && !(type === "file" && entry.mode === 0o755)) fail("ENTRY_MODE", "manifest mode is not normalized");
    assertSafeInteger(entry.size, "ENTRY_SIZE");
    if (type === "directory" && entry.size !== 0) fail("ENTRY_SIZE", "manifest directories must have zero size");
    if (type === "file") assertHex(entry.sha256, SHA256_RE, "ENTRY_DIGEST");
  }
  if (sha256Bytes(canonicalJson(manifest.payload.entries)) !== manifest.payload.entriesSha256) fail("ENTRIES_DIGEST", "payload entry digest mismatch");
  if (!seen.has("runtime/app/server.js")) fail("STANDALONE_ENTRYPOINT", "payload is missing app/server.js");
}

function compareEntries(expected, actual) {
  if (expected.length !== actual.length) fail("ARCHIVE_ENTRIES", "archive entry count differs from the manifest");
  for (let index = 0; index < expected.length; index += 1) {
    const left = expected[index];
    const right = actual[index];
    if (left.path !== right.path || left.type !== right.type || left.mode !== right.mode || left.size !== right.size || (left.type === "file" && left.sha256 !== right.sha256)) {
      fail("ARCHIVE_ENTRIES", "archive entries differ from the manifest");
    }
  }
}

export async function verifyReleaseArtifact({ archivePath, manifestPath, destinationPath = null }) {
  const resolvedArchive = path.resolve(archivePath);
  const resolvedManifest = path.resolve(manifestPath);
  const archiveStats = await lstat(resolvedArchive);
  const manifestStats = await lstat(resolvedManifest);
  if (!archiveStats.isFile() || archiveStats.isSymbolicLink() || !manifestStats.isFile() || manifestStats.isSymbolicLink()) {
    fail("ARTIFACT_FILE_TYPE", "archive and manifest must be regular non-symlink files");
  }
  const manifestBytes = await readFile(resolvedManifest);
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    fail("MANIFEST_JSON", "artifact manifest is not valid JSON");
  }
  validateManifest(manifest, resolvedArchive);
  const archive = await sha256File(resolvedArchive);
  if (archive.bytes !== manifest.archive.bytes || archive.sha256 !== manifest.archive.sha256) fail("ARCHIVE_DIGEST", "archive bytes do not match the manifest");
  const entries = await parseTar(resolvedArchive);
  compareEntries(manifest.payload.entries, entries);

  if (destinationPath !== null) {
    const destination = path.resolve(destinationPath);
    if (await pathExists(destination)) fail("DESTINATION_EXISTS", "verified extraction destination must not already exist");
    const parent = path.dirname(destination);
    const parentStats = await lstat(parent);
    if (!parentStats.isDirectory() || parentStats.isSymbolicLink()) fail("DESTINATION_PARENT", "destination parent must be a real directory");
    const staging = path.join(parent, `.${path.basename(destination)}.staging-${randomUUID()}`);
    try {
      await mkdir(staging, { recursive: false, mode: 0o700 });
      const extracted = await parseTar(resolvedArchive, staging);
      compareEntries(manifest.payload.entries, extracted);
      const after = await sha256File(resolvedArchive);
      if (after.bytes !== archive.bytes || after.sha256 !== archive.sha256) fail("ARCHIVE_CHANGED", "archive changed during verified extraction");
      if (await pathExists(destination)) fail("DESTINATION_EXISTS", "destination appeared during verified extraction");
      await rename(staging, destination);
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  return Object.freeze({
    schema: 1,
    releaseId: archive.sha256,
    sourceSha: manifest.source.commit,
    sourceTree: manifest.source.tree,
    serverActionsKeyFingerprint: manifest.build.serverActionsKeyFingerprint,
    builder: Object.freeze({ ...manifest.builder }),
    assurance: Object.freeze({ ...manifest.assurance }),
    archivePath: resolvedArchive,
    archiveSha256: archive.sha256,
    manifestPath: resolvedManifest,
    manifestSha256: sha256Bytes(manifestBytes),
    services: Object.freeze([{ serviceKey: "web", payloadRoot: SAFE_RUNTIME_ROOT }]),
  });
}
