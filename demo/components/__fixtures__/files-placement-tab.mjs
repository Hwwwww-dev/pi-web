// hooks/useFilesPlacement with the files in their own tab, the desktop
// setting's default: a test pins a layout by aliasing the hook to one of
// these fixtures, so its meaning does not move with the default.
export const FILES_PLACEMENT_STORAGE_KEY = "pi-web:sidebar-files-placement";
export const FILES_PLACEMENT_DEFAULT = "tab";

export function parseFilesPlacement(raw) {
  return raw === "below" ? "below" : FILES_PLACEMENT_DEFAULT;
}

export function setFilesPlacement() {}

export function useFilesPlacement() {
  return "tab";
}
