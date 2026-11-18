import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-write-route-")));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const previousRoots = globalThis.__piAllowedRootsCache;
process.env.PI_CODING_AGENT_DIR = path.join(base, "agent");
test.after(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  globalThis.__piAllowedRootsCache = previousRoots;
  fs.rmSync(base, { recursive: true, force: true });
});

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true });
const { PUT } = await jiti.import("./[...path]/route.ts");
const { encodeFilePathForApi } = await jiti.import("../../../lib/file-paths.ts");
const { NextRequest } = await jiti.import("next/server");

function fixture(content = "original contents") {
  const directory = fs.mkdtempSync(path.join(base, "files-"));
  globalThis.__piAllowedRootsCache = { roots: new Set([directory]), expiresAt: Date.now() + 60_000 };
  const destination = path.join(directory, "note.txt");
  fs.writeFileSync(destination, content);
  const stat = fs.statSync(destination);
  return {
    directory,
    destination,
    version: `${stat.size}:${stat.mtime.toISOString()}`,
  };
}

async function writeEdit(destination, body) {
  const encoded = encodeFilePathForApi(destination);
  return PUT(new NextRequest(`http://localhost/api/files/${encoded}?type=write`, {
    method: "PUT",
    headers: { host: "localhost", "content-type": "application/json" },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ path: encoded.split("/").map(decodeURIComponent) }) });
}

test("write saves content atomically and answers the new version", async () => {
  const { destination } = fixture();
  const response = await writeEdit(destination, {
    content: "replacement contents",
    baseVersion: fixtureVersion(destination),
  });
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.size, Buffer.byteLength("replacement contents"));
  assert.equal(typeof json.mtime, "string");
  assert.equal(fs.readFileSync(destination, "utf8"), "replacement contents");
  // The staging file is gone: the rename moved it onto the target.
  assert.deepEqual(fs.readdirSync(path.dirname(destination)), ["note.txt"]);
});

function fixtureVersion(destination) {
  const stat = fs.statSync(destination);
  return `${stat.size}:${stat.mtime.toISOString()}`;
}

test("write preserves the file mode through the rename", async () => {
  const { destination } = fixture();
  fs.chmodSync(destination, 0o755);
  const response = await writeEdit(destination, { content: "still executable" });
  assert.equal(response.status, 200);
  const mode = fs.statSync(destination).mode & 0o777;
  assert.equal(mode, 0o755);
  assert.equal(fs.readFileSync(destination, "utf8"), "still executable");
});

test("write with a stale baseVersion is refused with 409 and leaves the file alone", async () => {
  const { destination } = fixture();
  const stale = `${4}:${new Date(0).toISOString()}`;
  const response = await writeEdit(destination, { content: "hostile overwrite", baseVersion: stale });
  assert.equal(response.status, 409);
  const json = await response.json();
  assert.equal(json.error, "conflict");
  assert.equal(typeof json.current.size, "number");
  assert.equal(typeof json.current.mtime, "string");
  assert.equal(fs.readFileSync(destination, "utf8"), "original contents");
});

test("write with the current baseVersion succeeds", async () => {
  const { destination } = fixture();
  const response = await writeEdit(destination, { content: "updated", baseVersion: fixtureVersion(destination) });
  assert.equal(response.status, 200);
  assert.equal(fs.readFileSync(destination, "utf8"), "updated");
});

test("write follows a symlink to its target inside the roots", async () => {
  const { directory, destination } = fixture();
  const link = path.join(directory, "alias.txt");
  fs.symlinkSync(destination, link);
  const response = await writeEdit(link, { content: "via the link" });
  assert.equal(response.status, 200);
  assert.equal(fs.readFileSync(destination, "utf8"), "via the link");
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
});

test("write refuses a path outside the roots", async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-outside-"));
  try {
    const outsideFile = path.join(outside, "secret.txt");
    fs.writeFileSync(outsideFile, "do not touch");
    const response = await writeEdit(outsideFile, { content: "nope" });
    assert.equal(response.status, 403);
    assert.equal(fs.readFileSync(outsideFile, "utf8"), "do not touch");
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("write refuses a root-internal symlink pointing outside the roots", async () => {
  const { directory } = fixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-outside-"));
  try {
    const outsideFile = path.join(outside, "secret.txt");
    fs.writeFileSync(outsideFile, "do not touch");
    const escape = path.join(directory, "escape.txt");
    fs.symlinkSync(outsideFile, escape);
    const response = await writeEdit(escape, { content: "nope" });
    assert.equal(response.status, 403);
    assert.equal(fs.readFileSync(outsideFile, "utf8"), "do not touch");
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("write refuses a `..` path even when it lexically stays inside", async () => {
  const { directory, destination } = fixture();
  // Built by hand: path.join would normalize the `..` away before it can
  // reach the check that refuses it.
  const segments = [directory, "..", path.basename(directory), "note.txt"];
  const body = JSON.stringify({ content: "nope" });
  const response = await PUT(new NextRequest("http://localhost/api/files/x?type=write", {
    method: "PUT", headers: { host: "localhost", "content-type": "application/json" }, body,
  }), { params: Promise.resolve({ path: segments }) });
  assert.equal(response.status, 403);
  assert.equal(fs.readFileSync(destination, "utf8"), "original contents");
});

test("write answers 404 for a missing file", async () => {
  const { directory } = fixture();
  const response = await writeEdit(path.join(directory, "gone.txt"), { content: "x" });
  assert.equal(response.status, 404);
});

test("write answers 400 for a directory", async () => {
  const { directory } = fixture();
  const response = await writeEdit(directory, { content: "x" });
  assert.equal(response.status, 400);
});

test("write answers 400 when content is not a string", async () => {
  const { destination } = fixture();
  const response = await writeEdit(destination, { content: 42 });
  assert.equal(response.status, 400);
  assert.equal(fs.readFileSync(destination, "utf8"), "original contents");
});

test("write answers 413 above the size limit", async () => {
  const { destination } = fixture();
  const big = "x".repeat(2 * 1024 * 1024 + 1);
  const response = await writeEdit(destination, { content: big });
  assert.equal(response.status, 413);
  assert.equal(fs.readFileSync(destination, "utf8"), "original contents");
});

test("write answers 415 without a JSON content type", async () => {
  const { destination } = fixture();
  const encoded = encodeFilePathForApi(destination);
  const response = await PUT(new NextRequest(`http://localhost/api/files/${encoded}?type=write`, {
    method: "PUT",
    headers: { host: "localhost", "content-type": "text/plain" },
    body: "{}",
  }), { params: Promise.resolve({ path: encoded.split("/").map(decodeURIComponent) }) });
  assert.equal(response.status, 415);
});
