import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import { createJiti } from "jiti";
import ts from "typescript";

const jiti = createJiti(import.meta.url);
const { dropMentionText, splitDroppedItems } = await jiti.import("../lib/file-upload-client.ts");

const sourceText = readFileSync(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("ChatWindow.tsx", sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

/** Runs one of ChatWindow's useCallback bodies against the given scope. */
function chatWindowCallback(name, context) {
  function findCallback(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) {
      return node.initializer.arguments[0];
    }
    return ts.forEachChild(node, findCallback);
  }
  return new Script(ts.transpileModule(findCallback(source).getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText).runInNewContext(context);
}

const photo = new File(["x"], "photo.png", { type: "image/png" });
const report = new File(["x"], "report.pdf", { type: "application/pdf" });
const log = new File(["x"], "server.log", { type: "" });

/** Picks files with the composer's attach button, through ChatWindow's real drop path. */
async function attach(files, { response } = {}) {
  const calls = { images: [], uploads: [], mentions: [], notices: [] };
  const scope = {
    session: null,
    newSessionCwd: "/project",
    chatInputRef: {
      current: {
        addImages: (images) => calls.images.push(...images),
        insertText: (text) => calls.mentions.push(text),
      },
    },
    addNotice: (notice) => calls.notices.push([notice.type, notice.message]),
    t: (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
    splitDroppedItems,
    dropMentionText,
    uploadRepoDirectory: (domain) => `~/.pi-web/upload/${domain === "inspiration" ? "inspiration/" : ""}2026-01-01`,
    uploadFiles: async (target, uploads, strategy) => {
      calls.uploads.push([target, uploads.map((file) => file.name), strategy]);
      return response;
    },
  };
  scope.uploadDroppedFiles = chatWindowCallback("uploadDroppedFiles", scope);
  scope.onDrop = chatWindowCallback("onDrop", scope);
  chatWindowCallback("onAttachFiles", scope)(files);
  await new Promise((resolve) => setImmediate(resolve));
  return calls;
}

test("the attach button sends picked files to the upload repository and mentions them there", async () => {
  const mixed = await attach([photo, report, log], {
    response: { status: 207, data: { uploaded: ["report.pdf"], skipped: ["server.log"] } },
  });
  // Images attach to the prompt; the rest land in the dated repository directory
  // (never replacing a file) and are mentioned by their repository path.
  assert.deepEqual(mixed.images, [photo]);
  assert.deepEqual(mixed.uploads, [["~/.pi-web/upload/2026-01-01", ["report.pdf", "server.log"], "skip"]]);
  assert.deepEqual(mixed.mentions, ["@~/.pi-web/upload/2026-01-01/report.pdf @~/.pi-web/upload/2026-01-01/server.log "]);
  assert.deepEqual(mixed.notices, [
    ["success", 'chat.dropUploaded {"count":1}'],
    ["warning", 'chat.dropAlreadyExists {"names":"server.log"}'],
  ]);

  const imagesOnly = await attach([photo]);
  assert.deepEqual(imagesOnly.images, [photo]);
  assert.deepEqual(imagesOnly.uploads, []);
  assert.deepEqual(imagesOnly.notices, []);
});

test("without a working directory, picked files still reach the upload repository", async () => {
  const calls = await attach([report], {
    response: { status: 200, data: { uploaded: ["report.pdf"] } },
  });
  assert.deepEqual(calls.uploads, [["~/.pi-web/upload/2026-01-01", ["report.pdf"], "skip"]]);
  assert.deepEqual(calls.mentions, ["@~/.pi-web/upload/2026-01-01/report.pdf "]);
  assert.deepEqual(calls.notices, [["success", 'chat.dropUploaded {"count":1}']]);
});
