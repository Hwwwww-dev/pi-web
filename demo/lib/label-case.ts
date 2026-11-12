/**
 * Labels an extension hands us are free text (`setStatus("mode", "goal")`,
 * `/mode toggle`), and Pi's own footer prints them verbatim. A chip that sits
 * beside translated UI must still read like a word: one word gets a capital
 * first letter, an initials-style token (`mcp`, `ssh`, `lsp`) is all caps.
 */
const CJK = /[\u3040-\u30ff\u3400-\u9fff]|[\uac00-\ud7af]|[\uff00-\uffef]/;

/** Short tokens with no vowels are initials, not words: mcp, ssh, lsp, tty. */
const INITIALS = /^[bcdfghjklmnpqrstvwxyz]{2,5}$/i;

export function displayLabel(raw: string): string {
  const text = raw.trim();
  if (!text) return text;
  // Translated text carries its own casing rules; never touch it.
  if (CJK.test(text)) return text;
  // Already cased by whoever wrote it — an acronym, a proper noun, a path.
  if (/[A-Z]/.test(text)) return text;
  if (!/^[a-z]+$/.test(text)) return text;
  if (INITIALS.test(text)) return text.toUpperCase();
  return text[0].toUpperCase() + text.slice(1);
}
