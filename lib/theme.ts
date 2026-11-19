// Settings shows these as swatches, grouped: the built-in pair first, then the
// editor palettes. Each id is a complete `[data-theme="<id>"]` variable set in
// globals.css; `swatch` is [background, accent] for the chip, taken from that
// palette rather than from the theme currently running.
export const THEME_GROUPS = [
  { id: "builtin", label: "settings.themeGroupBuiltin" },
  { id: "editors", label: "settings.themeGroupEditors" },
] as const;

export type ThemeGroup = (typeof THEME_GROUPS)[number]["id"];

export const THEME_OPTIONS = [
  { id: "auto", label: "settings.themeSystem", scheme: null, group: "builtin", swatch: ["#ffffff", "#1a1a1a"] },
  { id: "light", label: "settings.themeLight", scheme: "light", group: "builtin", swatch: ["#ffffff", "#e5e5e5"] },
  { id: "dark", label: "settings.themeDark", scheme: "dark", group: "builtin", swatch: ["#1a1a1a", "#3c3c3c"] },
  { id: "vscode-light", label: "settings.themeVscodeLight", scheme: "light", group: "editors", swatch: ["#ffffff", "#007acc"] },
  { id: "vscode-dark", label: "settings.themeVscodeDark", scheme: "dark", group: "editors", swatch: ["#1e1e1e", "#007acc"] },
  { id: "github-light", label: "settings.themeGithubLight", scheme: "light", group: "editors", swatch: ["#ffffff", "#1f883d"] },
  { id: "github-dark", label: "settings.themeGithubDark", scheme: "dark", group: "editors", swatch: ["#0d1117", "#1f6feb"] },
  { id: "one-dark", label: "settings.themeOneDark", scheme: "dark", group: "editors", swatch: ["#282c34", "#61afef"] },
  { id: "dracula", label: "settings.themeDracula", scheme: "dark", group: "editors", swatch: ["#282a36", "#bd93f9"] },
  { id: "nord", label: "settings.themeNord", scheme: "dark", group: "editors", swatch: ["#2e3440", "#88c0d0"] },
  { id: "solarized-light", label: "settings.themeSolarizedLight", scheme: "light", group: "editors", swatch: ["#fdf6e3", "#268bd2"] },
] as const;

export type ThemePreference = (typeof THEME_OPTIONS)[number]["id"];
export type ResolvedTheme = Exclude<ThemePreference, "auto">;

export const LIGHT_THEMES: readonly ResolvedTheme[] = THEME_OPTIONS.flatMap((option) => (option.scheme === "light" ? [option.id] : []));
export const DARK_THEMES: readonly ResolvedTheme[] = THEME_OPTIONS.flatMap((option) => (option.scheme === "dark" ? [option.id] : []));

export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_OPTIONS.some((option) => option.id === value);
}

export function isDarkTheme(theme: ResolvedTheme): boolean {
  return DARK_THEMES.includes(theme);
}

// Apply the saved palette before first paint, including when storage is blocked.
export const THEME_INIT_SCRIPT = `(function(){var t="auto";try{var s=localStorage.getItem("pi-theme");if(${JSON.stringify(THEME_OPTIONS.map((option) => option.id))}.includes(s))t=s}catch(e){}if(t==="auto")t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";var r=document.documentElement;r.dataset.theme=t;r.classList.toggle("dark",${JSON.stringify(DARK_THEMES)}.includes(t))})();`;
