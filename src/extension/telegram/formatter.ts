const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

const HTML_ESCAPE_RE = /[&<>"]/g;

export function escapeHtml(s: string): string {
  return s.replace(HTML_ESCAPE_RE, (ch) => HTML_ESCAPES[ch]);
}

const TRUNCATION_SUFFIX = "…(truncated)";

export function truncateMessage(text: string, maxLen = 4096): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX;
}

/**
 * Convert markdown text to Telegram HTML (for use with parse_mode: "HTML").
 *
 * Telegram supports: <b>, <i>, <s>, <u>, <code>, <pre>, <a>, <blockquote>
 * Unsupported tags cause the entire message to fail — only emit known-safe tags.
 *
 * Processing order:
 *   1. Extract fenced code blocks (prevents markdown processing inside code)
 *   2. Extract inline code spans
 *   3. Escape HTML entities in remaining text
 *   4. Apply **bold**, *italic*, ~~strike~~, and # heading formatting
 *   5. Restore code placeholders
 */
export function markdownToTelegramHtml(text: string): string {
  const codeBlocks: string[] = [];
  const inlineCodes: string[] = [];

  // Step 1: Fenced code blocks (``` ... ```)
  let result = text.replace(/```(?:\w*)\n?([\s\S]*?)```/g, (_match, code: string) => {
    const escaped = escapeHtml(code.replace(/\n$/, ""));
    codeBlocks.push(`<pre><code>${escaped}</code></pre>`);
    return `\x00C${codeBlocks.length - 1}\x00`;
  });

  // Step 2: Inline code (`...`)
  result = result.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return `\x00I${inlineCodes.length - 1}\x00`;
  });

  // Step 3: Escape HTML in non-code text (\x00 chars survive — none are &<>")
  result = escapeHtml(result);

  // Step 4: Markdown formatting (applied after HTML-escaping so tags are safe)
  // Bold: **text**
  result = result.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  // Italic: *text* (skip _text_ to avoid false positives with snake_case identifiers)
  result = result.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<i>$1</i>");
  // Strikethrough: ~~text~~
  result = result.replace(/~~(.+?)~~/g, "<s>$1</s>");
  // Headers: # / ## / ### → bold line
  result = result.replace(/^#{1,3} (.+)$/gm, "<b>$1</b>");

  // Step 5: Restore placeholders
  result = result.replace(/\x00I(\d+)\x00/g, (_m, i) => inlineCodes[parseInt(i, 10)]);
  result = result.replace(/\x00C(\d+)\x00/g, (_m, i) => codeBlocks[parseInt(i, 10)]);

  return result;
}
