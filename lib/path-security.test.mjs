import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { hasParentDirectorySegment, isExistingPathWithinRoots, isPathWithinRoots, resolveRealRoots } =
  await jiti.import("./path-security.ts");

const ROOTS = () => new Set(["/tmp/pi-web-roots"]);

test("a target inside a root is allowed, beside a root is not", () => {
  const roots = ROOTS();
  assert.equal(isPathWithinRoots("/tmp/pi-web-roots/a.ts", roots), true);
  assert.equal(isPathWithinRoots("/tmp/pi-web-roots", roots), true);
  assert.equal(isPathWithinRoots("/tmp/pi-web-roots/deep/dir/f.ts", roots), true);
  // A sibling that merely shares the root's textual prefix is not inside.
  assert.equal(isPathWithinRoots("/tmp/pi-web-rootsx/a.ts", roots), false);
  assert.equal(isPathWithinRoots("/etc/passwd", roots), false);
  assert.equal(isPathWithinRoots("/tmp/pi-web-roots-evil/a.ts", roots), false);
});

test("a trailing slash on the root does not change the answer", () => {
  const roots = new Set(["/tmp/pi-web-roots/"]);
  assert.equal(isPathWithinRoots("/tmp/pi-web-roots/a.ts", roots), true);
  assert.equal(isPathWithinRoots("/tmp/pi-web-rootsx/a.ts", roots), false);
});

test("the lexical check collapses `..` before comparing; the existing-path check refuses it", () => {
  // path.resolve folds `..` first, so containment holds; refusing lexical `..`
  // is isExistingPathWithinRoots' job, because the filesystem applies `..`
  // after following links (#748).
  assert.equal(isPathWithinRoots("/tmp/pi-web-roots/../pi-web-roots/a.ts", ROOTS()), true);
});

test("windows rules apply when either side is a windows absolute path", () => {
  const roots = new Set(["C:\\repo"]);
  assert.equal(isPathWithinRoots("C:\\repo\\sub\\f.ts", roots), true);
  assert.equal(isPathWithinRoots("C:\\other\\f.ts", roots), false);
  // Drive-letter case and separator style never decide the answer.
  assert.equal(isPathWithinRoots("c:/REPO/a.ts", roots), true);
  assert.equal(isPathWithinRoots("C:\\repoX\\a.ts", roots), false);
  // A posix path compared against windows rules cannot be inside.
  assert.equal(isPathWithinRoots("/home/user/a.ts", roots), false);
});

test("a UNC root authorizes its own children", () => {
  const roots = new Set(["//server/share"]);
  assert.equal(isPathWithinRoots("//server/share/dir/f.ts", roots), true);
  assert.equal(isPathWithinRoots("//server/other/f.ts", roots), false);
});

test("hasParentDirectorySegment splits on the separators the path uses", () => {
  assert.equal(hasParentDirectorySegment("/a/../b"), true);
  assert.equal(hasParentDirectorySegment("../x"), true);
  assert.equal(hasParentDirectorySegment("/a/b"), false);
  assert.equal(hasParentDirectorySegment("/a/b/.."), true);
  assert.equal(hasParentDirectorySegment("C:\\a\\..\\b"), true);
  assert.equal(hasParentDirectorySegment("C:\\a\\b"), false);
  // On posix a backslash is part of a file name, not a separator.
  assert.equal(hasParentDirectorySegment("/a\\..\\b"), false);
});

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-pathsec-")));
const root = path.join(base, "root");
const outside = path.join(base, "outside");
fs.mkdirSync(path.join(root, "inner"), { recursive: true });
fs.mkdirSync(outside);
fs.writeFileSync(path.join(root, "inner", "f.ts"), "f");
fs.writeFileSync(path.join(outside, "secret.txt"), "s");
const dirType = process.platform === "win32" ? "junction" : "dir";
fs.symlinkSync(outside, path.join(root, "escape"), dirType);
fs.symlinkSync(path.join(root, "inner"), path.join(root, "alias"), dirType);
const allowedRoots = new Set([root]);

test.after(() => fs.rmSync(base, { recursive: true, force: true }));

test("an existing path resolves links before containment", () => {
  assert.equal(isExistingPathWithinRoots(path.join(root, "inner", "f.ts"), allowedRoots), true);
  assert.equal(isExistingPathWithinRoots(path.join(root, "alias", "f.ts"), allowedRoots), true);
  // A link inside the root that leads outside every root (#748).
  assert.equal(isExistingPathWithinRoots(path.join(root, "escape", "secret.txt"), allowedRoots), false);
});

test("a path with a `..` segment is refused before the filesystem is consulted", () => {
  // Even though it would resolve to an allowed location, the filesystem
  // applies `..` after links, so `root/alias/../x` would name a file beside
  // the link's target. (Built as strings: path.join would fold the `..`.)
  assert.equal(isExistingPathWithinRoots(`${root}/inner/../inner/f.ts`, allowedRoots), false);
  assert.equal(isExistingPathWithinRoots(`${root}/escape/../escape/secret.txt`, allowedRoots), false);
});

test("a missing path is refused", () => {
  assert.equal(isExistingPathWithinRoots(path.join(root, "gone", "f.ts"), allowedRoots), false);
});

test("resolveRealRoots keeps resolvable roots and drops stale ones", () => {
  const stale = path.join(base, "removed-root");
  const resolved = resolveRealRoots(new Set([root, stale]));
  assert.equal(resolved.has(root), true);
  assert.equal(resolved.has(stale), false);
});
