export function sanitizeExtensionStatusText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\t/g, " ").replace(/ +/g, " ").trim())
    .join("\n")
    .trim();
}

/**
 * pi-permission-system reports a permissive run as the bare status "yolo"
 * (`PERMISSION_SYSTEM_YOLO_STATUS_VALUE`). pi-web renders the marker as the
 * red pill on the status row under the composer (ExtensionStatusBar) — the
 * composer's own controls row no longer repeats it.
 */
export function isPermissiveStatusText(text: string): boolean {
  return sanitizeExtensionStatusText(text).toLowerCase() === "yolo";
}
