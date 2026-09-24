const ANSI_ESCAPE_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;
const ANSI_ESCAPE_AT_START_RE = /^\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/;
const TUI_CURSOR_MARKER_RE = /\x1B_pi:c\x07/g;

// Glyphs that only a terminal renderer produces: box drawing, block elements,
// geometric shapes (spinners, markers) and braille spinner frames.
const TUI_GLYPH_RE = /[\u2500-\u257f\u2580-\u259f\u25a0-\u25ff\u2800-\u28ff]/;
// A rule line, or padding spaces lining columns up (tables, key/value blocks).
const TUI_RULE_RE = /^\s*[=\-_*~─━]{8,}\s*$/;
const TUI_COLUMN_RE = /\S {3,}\S/;
const TUI_ALIGNED_LINE_COUNT = 2;

/**
 * Terminal output carries its meaning in the layout: reflowing it to the
 * container width tears box art, tables and progress bars apart. Detect that
 * shape so such text renders unwrapped and scrolls instead.
 */
export function isTuiText(text: string): boolean {
  if (!text) return false;
  if (TUI_GLYPH_RE.test(text)) return true;
  let quoted = 0;
  let aligned = 0;
  for (const line of text.split("\n")) {
    quoted += 1;
    if (TUI_RULE_RE.test(line)) return true;
    if (TUI_COLUMN_RE.test(line)) aligned += 1;
  }
  return quoted > 1 && aligned >= TUI_ALIGNED_LINE_COUNT;
}

export function stripAnsi(text: string): string {
  return text.replace(TUI_CURSOR_MARKER_RE, "").replace(ANSI_ESCAPE_RE, "");
}

function visibleCharPositions(text: string): Array<{ start: number; end: number; char: string }> {
  const positions: Array<{ start: number; end: number; char: string }> = [];
  let i = 0;
  while (i < text.length) {
    if (text.charCodeAt(i) === 0x1b) {
      const match = text.slice(i).match(ANSI_ESCAPE_AT_START_RE);
      if (match) {
        i += match[0].length;
        continue;
      }
    }
    const codePoint = text.codePointAt(i);
    if (codePoint === undefined) break;
    const char = String.fromCodePoint(codePoint);
    positions.push({ start: i, end: i + char.length, char });
    i += char.length;
  }
  return positions;
}

function removeVisibleCharAt(text: string, index: number): string {
  const positions = visibleCharPositions(text);
  const pos = positions[index];
  if (!pos) return text;
  return text.slice(0, pos.start) + text.slice(pos.end);
}

function firstVisibleChar(text: string): string | undefined {
  return visibleCharPositions(text)[0]?.char;
}

function lastNonSpaceVisibleCharIndex(text: string): number {
  const positions = visibleCharPositions(text);
  for (let i = positions.length - 1; i >= 0; i--) {
    if (positions[i].char.trim() !== "") return i;
  }
  return -1;
}

function trimEndVisibleSpaces(text: string): string {
  let next = text;
  while (true) {
    const positions = visibleCharPositions(next);
    const last = positions[positions.length - 1];
    if (!last || last.char.trim() !== "") return next;
    next = next.slice(0, last.start) + next.slice(last.end);
  }
}

export function normalizeCustomPanelLines(lines: string[]): string[] {
  const horizontalFrameLine = /^[┌├└╭╰][─┬┴┼]+[┐┤┘╮╯]$/;
  const normalized: string[] = [];

  for (const rawLine of lines) {
    const lineWithoutCursor = rawLine.replace(TUI_CURSOR_MARKER_RE, "");
    const plain = stripAnsi(lineWithoutCursor).trimEnd();
    if (horizontalFrameLine.test(plain)) continue;

    let line = lineWithoutCursor;
    const first = firstVisibleChar(line);
    if (first === "│" || first === "┃") {
      line = removeVisibleCharAt(line, 0);
      if (firstVisibleChar(line) === " ") line = removeVisibleCharAt(line, 0);
    }

    const rightBorderIndex = lastNonSpaceVisibleCharIndex(line);
    const rightBorder = rightBorderIndex >= 0 ? visibleCharPositions(line)[rightBorderIndex]?.char : undefined;
    if (rightBorder === "│" || rightBorder === "┃") {
      line = removeVisibleCharAt(line, rightBorderIndex);
    }

    normalized.push(trimEndVisibleSpaces(line));
  }

  while (normalized.length > 0 && stripAnsi(normalized[0]).trim() === "") normalized.shift();
  while (normalized.length > 0 && stripAnsi(normalized[normalized.length - 1]).trim() === "") normalized.pop();
  return normalized.length ? normalized : lines;
}
