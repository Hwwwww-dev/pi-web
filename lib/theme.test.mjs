import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import {
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  THEME_INIT_SCRIPT,
  THEME_OPTIONS,
  isDarkTheme,
  paletteForScheme,
  paletteScheme,
  STORAGE_KEYS,
} from "./theme.ts";

const PALETTE_IDS = THEME_OPTIONS.map(({ id }) => id);

function firstPaint({ mode, light, dark, systemDark = false, blocked = false }) {
  const root = { dataset: {}, classList: { toggle: (name, value) => { root[name] = value; } } };
  const stored = new Map([
    [STORAGE_KEYS.mode, mode],
    [STORAGE_KEYS.light, light],
    [STORAGE_KEYS.dark, dark],
  ]);
  runInNewContext(THEME_INIT_SCRIPT, {
    localStorage: {
      getItem: (key) => {
        if (blocked) throw new Error("Blocked");
        return stored.get(key) ?? null;
      },
    },
    window: { matchMedia: () => ({ matches: systemDark }) },
    document: { documentElement: root },
  });
  return root;
}

test("first paint runs the palette stored for the resolved scheme", () => {
  for (const mode of ["auto", "light", "dark"]) {
    for (const systemDark of [false, true]) {
      const root = firstPaint({
        mode,
        light: "catppuccin-latte",
        dark: "tokyo-night",
        systemDark,
      });
      const dark = mode === "dark" || (mode === "auto" && systemDark);
      assert.equal(root.dataset.theme, dark ? "tokyo-night" : "catppuccin-latte");
      assert.equal(root.dark, dark);
    }
  }
});

test("first paint falls back to the defaults for invalid values and blocked storage", () => {
  for (const bad of [null, "", "unknown", "auto"]) {
    const root = firstPaint({ mode: bad, light: bad, dark: bad });
    assert.equal(root.dataset.theme, DEFAULT_LIGHT_THEME);
    assert.equal(root.dark, false);
  }
  const blocked = firstPaint({ mode: "dark", light: "nord", dark: "nord", blocked: true });
  assert.equal(blocked.dataset.theme, DEFAULT_LIGHT_THEME);
  assert.equal(blocked.dark, false);
});

test("a palette stored for the other scheme is replaced by that scheme's default", () => {
  assert.equal(paletteForScheme("light", "dracula", "nord"), DEFAULT_LIGHT_THEME);
  assert.equal(paletteForScheme("dark", "solarized-light", "nord"), "nord");
  assert.equal(paletteForScheme("light", "catppuccin-latte", "nord"), "catppuccin-latte");
  assert.equal(paletteForScheme("dark", "nord", "solarized-light"), DEFAULT_DARK_THEME);
});

test("every palette has exactly one scheme, and the two built-ins are the neutral ones", () => {
  const light = PALETTE_IDS.filter((id) => paletteScheme(id) === "light");
  const dark = PALETTE_IDS.filter((id) => paletteScheme(id) === "dark");
  assert.equal(new Set([...light, ...dark]).size, PALETTE_IDS.length);
  assert.ok(light.includes("light") && dark.includes("dark"));
  assert.equal(isDarkTheme("light"), false);
  assert.equal(isDarkTheme("dark"), true);
});

test("every palette except the built-ins has a complete block in app/themes.css", () => {
  const css = readFileSync(new URL("../app/themes.css", import.meta.url), "utf8");
  for (const id of PALETTE_IDS) {
    if (id === "light" || id === "dark") continue;
    const block = css.match(new RegExp(`html\\[data-theme="${id}"\\] \\{([\\s\\S]*?)\\n\\}`));
    assert.ok(block, `${id} has no [data-theme] block`);
    const vars = new Set([...block[1].matchAll(/(--[a-z-]+):/g)].map((hit) => hit[1]));
    for (const required of [
      "--background", "--foreground", "--card", "--popover", "--primary", "--secondary",
      "--muted", "--accent", "--destructive", "--border", "--input", "--ring",
      "--sidebar", "--sidebar-border", "--warning", "--ok", "--info", "--diff-add", "--diff-del",
    ]) {
      assert.ok(vars.has(required), `${id} is missing ${required}`);
    }
    assert.match(block[1], new RegExp(`color-scheme: ${paletteScheme(id)};`));
  }
});
