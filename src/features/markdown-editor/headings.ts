import type { Text } from "@codemirror/state";
import { headingSlug } from "@/core/shell/services/workspace-references";

/** Position of the heading whose text or slug matches `anchor`, or -1. */
export function findHeading(doc: Text, anchor: string): number {
  const wanted = headingSlug(anchor.replace(/^#/, ""));
  if (!wanted) return -1;
  let inCode = false;
  for (let number = 1; number <= doc.lines; number++) {
    const line = doc.line(number);
    if (/^\s*(```|~~~)/.test(line.text)) inCode = !inCode;
    if (inCode) continue;
    const match = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line.text);
    if (match && headingSlug(match[1]) === wanted) return line.from;
  }
  return -1;
}
