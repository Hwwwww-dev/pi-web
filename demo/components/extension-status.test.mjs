import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  tsconfigPaths: true,
});
const {
  isPermissiveStatusText,
  sanitizeExtensionStatusText,
} = await jiti.import("@/lib/extension-status");

test("preserves status line breaks while normalizing horizontal whitespace", () => {
  assert.equal(
    sanitizeExtensionStatusText("  first\tsecond \r\n third  "),
    "first second\nthird",
  );
});

test("recognizes the permissive marker text, and only it", () => {
  assert.equal(isPermissiveStatusText("yolo"), true);
  assert.equal(isPermissiveStatusText("  YOLO\n"), true);
  assert.equal(isPermissiveStatusText("yolomatic"), false);
  assert.equal(isPermissiveStatusText(""), false);
});
