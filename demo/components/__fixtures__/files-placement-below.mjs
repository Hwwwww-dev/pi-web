// hooks/useFilesPlacement with the files below the sessions, the desktop
// setting's one choice: a test pins a layout by aliasing the hook to one of
// these fixtures (the real default is the files' own tab).
export const FILES_PLACEMENT_STORAGE_KEY = "pi-web:sidebar-files-placement";
export const FILES_PLACEMENT_DEFAULT = "tab";

export function parseFilesPlacement(raw) {
  return raw === "below" ? "below" : FILES_PLACEMENT_DEFAULT;
}

export function setFilesPlacement() {}

export function useFilesPlacement() {
  return "below";
}
