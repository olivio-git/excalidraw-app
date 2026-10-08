// ---------------------------------------------------------------------------
// Tool call input/output as readable text, for the chat's tool details
// ---------------------------------------------------------------------------

const MAX_CHARS = 20_000;

function clip(text: string): string {
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n…` : text;
}

/**
 * JSON objects become one `key: value` line per field, with multi-line strings
 * (command output, run summaries) shown as they are instead of escaped. Anything
 * else (plain text, JSON still streaming in) is returned unchanged.
 */
export function formatToolText(text: string): string {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return clip(text);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return clip(typeof value === "string" ? value : JSON.stringify(value, null, 2));
  }
  const lines = Object.entries(value as Record<string, unknown>).map(([key, field]) => {
    if (typeof field === "string") {
      if (!field.includes("\n")) return `${key}: ${field}`;
      return `${key}:\n${field.replace(/\n$/, "")}`;
    }
    return `${key}: ${JSON.stringify(field, null, 2)}`;
  });
  return clip(lines.join("\n"));
}
