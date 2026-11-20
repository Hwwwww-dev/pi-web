// Two stored choices, one per scheme: Settings shows the light palettes under
// "浅色配色" and the dark ones under "深色配色", and the light/dark switch (or
// the system preference) picks which of the two runs. Every id is a complete
// `[data-theme="<id>"]` variable set in app/themes.css; `light` and `dark` are
// the neutral built-ins (`:root` / `.dark`), so they have no block of their own.
// `swatch` is [background, accent] for the chip, taken from that palette rather
// than from the theme currently running.

export const THEME_GROUPS = [
  { id: "builtin", label: "settings.themeGroupBuiltin" },
  { id: "editors", label: "settings.themeGroupEditors" },
  { id: "community", label: "settings.themeGroupCommunity" },
] as const;

export type ThemeGroup = (typeof THEME_GROUPS)[number]["id"];

export const THEME_OPTIONS = [
  { id: "light", label: "settings.themeLight", scheme: "light", group: "builtin", swatch: ["#ffffff", "#e5e5e5"] },
  { id: "dark", label: "settings.themeDark", scheme: "dark", group: "builtin", swatch: ["#1a1a1a", "#3c3c3c"] },
  { id: "vscode-light", label: "settings.themeVscodeLight", scheme: "light", group: "editors", swatch: ["#ffffff", "#007acc"] },
  { id: "vscode-dark", label: "settings.themeVscodeDark", scheme: "dark", group: "editors", swatch: ["#1e1e1e", "#007acc"] },
  { id: "github-light", label: "settings.themeGithubLight", scheme: "light", group: "editors", swatch: ["#ffffff", "#1f883d"] },
  { id: "github-dark", label: "settings.themeGithubDark", scheme: "dark", group: "editors", swatch: ["#0d1117", "#1f6feb"] },
  { id: "one-light", label: "settings.themeOneLight", scheme: "light", group: "editors", swatch: ["#fafafa", "#4078f2"] },
  { id: "one-dark", label: "settings.themeOneDark", scheme: "dark", group: "editors", swatch: ["#282c34", "#61afef"] },
  { id: "solarized-light", label: "settings.themeSolarizedLight", scheme: "light", group: "editors", swatch: ["#fdf6e3", "#268bd2"] },
  { id: "solarized-dark", label: "settings.themeSolarizedDark", scheme: "dark", group: "editors", swatch: ["#002b36", "#268bd2"] },
  { id: "dracula", label: "settings.themeDracula", scheme: "dark", group: "editors", swatch: ["#282a36", "#bd93f9"] },
  { id: "nord", label: "settings.themeNord", scheme: "dark", group: "editors", swatch: ["#2e3440", "#88c0d0"] },
  { id: "monokai", label: "settings.themeMonokai", scheme: "dark", group: "editors", swatch: ["#272822", "#66d9ef"] },
  { id: "catppuccin-latte", label: "settings.themeCatppuccinLatte", scheme: "light", group: "community", swatch: ["#eff1f5", "#1e66f5"] },
  { id: "catppuccin-mocha", label: "settings.themeCatppuccinMocha", scheme: "dark", group: "community", swatch: ["#1e1e2e", "#89b4fa"] },
  { id: "rose-pine-dawn", label: "settings.themeRosePineDawn", scheme: "light", group: "community", swatch: ["#faf4ed", "#907aa9"] },
  { id: "rose-pine-moon", label: "settings.themeRosePineMoon", scheme: "dark", group: "community", swatch: ["#232136", "#c4a7e7"] },
  { id: "gruvbox-light", label: "settings.themeGruvboxLight", scheme: "light", group: "community", swatch: ["#fbf1c7", "#076678"] },
  { id: "gruvbox-dark", label: "settings.themeGruvboxDark", scheme: "dark", group: "community", swatch: ["#282828", "#83a598"] },
  { id: "tokyo-night-day", label: "settings.themeTokyoNightDay", scheme: "light", group: "community", swatch: ["#e1e2e7", "#2e7de9"] },
  { id: "tokyo-night", label: "settings.themeTokyoNight", scheme: "dark", group: "community", swatch: ["#1a1b26", "#7aa2f7"] },
  { id: "ayu-light", label: "settings.themeAyuLight", scheme: "light", group: "community", swatch: ["#fafafa", "#ff9940"] },
  { id: "ayu-mirage", label: "settings.themeAyuMirage", scheme: "dark", group: "community", swatch: ["#1f2430", "#ffcc66"] },
] as const;

export type ThemePalette = (typeof THEME_OPTIONS)[number]["id"];
/** The palette the page currently runs. */
export type ResolvedTheme = ThemePalette;

/** 用户选的是浅/深/跟随系统；配色由该方案下选中的那套决定。 */
export const THEME_MODES = [
  { id: "auto", label: "settings.themeSystem" },
  { id: "light", label: "settings.themeLight" },
  { id: "dark", label: "settings.themeDark" },
] as const;

export type ThemeMode = (typeof THEME_MODES)[number]["id"];

export type ThemeScheme = "light" | "dark";

export const DEFAULT_LIGHT_THEME: ThemePalette = "github-light";
export const DEFAULT_DARK_THEME: ThemePalette = "github-dark";

export const STORAGE_KEYS = {
  mode: "pi-theme-mode",
  light: "pi-theme-light",
  dark: "pi-theme-dark",
} as const;

export function paletteById(id: unknown): (typeof THEME_OPTIONS)[number] | undefined {
  return THEME_OPTIONS.find((option) => option.id === id);
}

export function isThemePalette(value: unknown): value is ThemePalette {
  return typeof value === "string" && THEME_OPTIONS.some((option) => option.id === value);
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === "string" && THEME_MODES.some((option) => option.id === value);
}

export function paletteScheme(id: ThemePalette): ThemeScheme {
  return paletteById(id)?.scheme === "dark" ? "dark" : "light";
}

export function palettesOf(scheme: ThemeScheme) {
  return THEME_OPTIONS.filter((option) => option.scheme === scheme);
}

export function isDarkTheme(theme: ThemePalette): boolean {
  return paletteScheme(theme) === "dark";
}

/** 该方案应当用的那套配色；存的值若不属于该方案，回退到默认。 */
export function paletteForScheme(
  scheme: ThemeScheme,
  light: ThemePalette,
  dark: ThemePalette,
): ThemePalette {
  if (scheme === "dark") return isDarkTheme(dark) ? dark : DEFAULT_DARK_THEME;
  return isDarkTheme(light) ? DEFAULT_LIGHT_THEME : light;
}

// Apply the saved palettes before first paint, including when storage is blocked.
export const THEME_INIT_SCRIPT = `(function(){var L=${JSON.stringify(THEME_OPTIONS.map((option) => option.id))},mode="auto",light=${JSON.stringify(DEFAULT_LIGHT_THEME)},dark=${JSON.stringify(DEFAULT_DARK_THEME)};try{var m=localStorage.getItem(${JSON.stringify(STORAGE_KEYS.mode)});if(m==="auto"||m==="light"||m==="dark")mode=m;var l=localStorage.getItem(${JSON.stringify(STORAGE_KEYS.light)});if(L.includes(l))light=l;var d=localStorage.getItem(${JSON.stringify(STORAGE_KEYS.dark)});if(L.includes(d))dark=d}catch(e){}var scheme=mode==="auto"?(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):mode;var t=scheme==="dark"?dark:light;var r=document.documentElement;r.dataset.theme=t;r.classList.toggle("dark",scheme==="dark")})();`;
