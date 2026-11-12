/**
 * A tool call's arguments as flat fields, for the card that shows them as a
 * table instead of a JSON blob.
 *
 * The rule is structural, so it covers every tool — built-in, package and MCP —
 * without a list of names or keys to keep current: **all of the arguments or
 * none of them.** A value that is an object or an array (an `edit` call's
 * `edits[]`, an MCP tool's nested argument) takes the whole card back to the
 * JSON view, because a one-level table cannot show a tree and a row that
 * quietly drops a subtree is an argument the user never sees.
 */

export interface ToolField {
  key: string;
  value: string;
  /** The value has newlines of its own, so its row keeps them as a block. */
  multiline: boolean;
}

/** What an empty argument is worth in a table: something the eye can find. */
export const EMPTY_FIELD_VALUE = "(empty)";

/** 嵌套值展平成带路径的键（`tasks[0].subject`），数组下标进键名。 */
function flattenInto(fields: ToolField[], path: string, value: unknown): boolean {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      fields.push({ key: path, value: "[]", multiline: false });
      return true;
    }
    return value.every((item, index) => flattenInto(fields, `${path}[${index}]`, item));
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      fields.push({ key: path, value: "{}", multiline: false });
      return true;
    }
    return entries.every(([key, item]) => flattenInto(fields, path === "" ? key : `${path}.${key}`, item));
  }
  const text = value === null ? "null" : String(value);
  fields.push({ key: path, value: text === "" ? EMPTY_FIELD_VALUE : text, multiline: text.includes("\n") });
  return true;
}

/**
 * The arguments as rows, in the order the tool received them, or `null` when
 * this call is not a record at all (streamed or not an object).
 *
 * 嵌套对象与数组也展开成行（`tasks[0].subject`），所以 JSON 参数不再以一行
 * 原始串出现；只有键值对本身的结构会变，值始终是字符串。
 */
export function toolFieldsOfInput(input: unknown): ToolField[] | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  const entries = Object.entries(input);
  if (entries.length === 0) return null;

  const fields: ToolField[] = [];
  flattenInto(fields, "", { ...input });
  return fields.length > 0 ? fields : null;
}
