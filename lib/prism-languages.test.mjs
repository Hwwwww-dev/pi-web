import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { refractor } from "refractor/core";

const { loadPrismLanguages, prismLanguagesLoaded } = await createJiti(import.meta.url).import("./prism-languages.ts");

test("a mapped language loads on demand into the core PrismLight renders with", async () => {
  // PrismLight (react-syntax-highlighter/dist/esm/prism-light) highlights with refractor/core.
  assert.equal(refractor.registered("tsx"), false);

  const first = loadPrismLanguages("tsx");
  assert.equal(loadPrismLanguages("tsx"), first, "one load per caller");
  await first;

  assert.equal(prismLanguagesLoaded("tsx"), true);
  assert.equal(refractor.registered("jsx"), true, "tsx pulls jsx in as its dependency");
  const tree = refractor.highlight("const a = <div className=\"x\" />;", "tsx");
  assert.ok(tree.children.some((node) => node.type === "element"), "tsx is tokenized");
});

test("baseline languages ship with refractor's common build", () => {
  for (const name of ["javascript", "js", "typescript", "ts", "bash", "sh", "shell", "python", "py", "json", "yaml", "yml", "css", "markup", "html", "diff", "rust", "go", "java", "kotlin", "ruby", "sql", "markdown", "php"]) {
    assert.equal(refractor.registered(name), true, `${name} is registered`);
  }
});

test("languages outside the map stay unregistered and stay plain text", async () => {
  assert.equal(prismLanguagesLoaded("not-a-language"), false);
  await loadPrismLanguages("not-a-language");
  assert.equal(prismLanguagesLoaded("not-a-language"), false);
});
