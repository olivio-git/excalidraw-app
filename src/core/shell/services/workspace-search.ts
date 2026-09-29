import { readDir, readTextFile, stat } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import {
  decodeDocument,
  inlineText,
  isRichNote,
  type DocumentBlock,
  type DocumentSnapshot,
} from "@/features/document-editor/note-format";
import { headingSlug } from "./workspace-references";

/**
 * Text search across the workspace. Each kind of file is searched by what a
 * person reads in it: note blocks, Markdown lines, diagram texts, flow steps,
 * code lines. Results carry an anchor, so opening one lands on the block,
 * heading, shape or step (the editors already understand those anchors).
 */

export interface SearchMatch {
  /** The line or block text around the match. */
  text: string;
  /** Match position inside `text`. */
  start: number;
  end: number;
  /** Where to land when opening: block id, heading slug, element id, step id. */
  anchor: string;
  /** 1-based line for text files. */
  line?: number;
  /** Extra context shown next to the match (heading, step kind…). */
  context?: string;
}

export interface SearchFileResult {
  path: string;
  matches: SearchMatch[];
}

export interface SearchOptions {
  caseSensitive?: boolean;
  regex?: boolean;
  wholeWord?: boolean;
  maxResults?: number;
  maxFiles?: number;
}

export interface SearchSummary {
  files: SearchFileResult[];
  total: number;
  scanned: number;
  truncated: boolean;
}

interface Segment {
  text: string;
  anchor: string;
  line?: number;
  context?: string;
}

const TEXT_FILES =
  /\.(md|markdown|txt|note|excalidraw|flow3d|json|ya?ml|toml|csv|ts|tsx|js|jsx|mjs|cjs|css|scss|html|py|rs|go|java|kt|rb|php|sh|sql|xml|svg|ini|env)$/i;
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "target", ".next", ".cache"]);
const MAX_FILE_BYTES = 1_000_000;

export function buildMatcher(query: string, options: SearchOptions = {}): RegExp | null {
  if (!query) return null;
  let source = options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (options.wholeWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  try {
    return new RegExp(source, `gu${options.caseSensitive ? "" : "i"}`);
  } catch {
    return null;
  }
}

function blockSegments(blocks: DocumentBlock[], rich: boolean): Segment[] {
  const segments: Segment[] = [];
  let heading = "";
  let headingText = "";
  const visit = (items: DocumentBlock[]) => {
    for (const block of items) {
      const text = inlineText(block.content);
      if (block.type === "heading") {
        heading = headingSlug(text);
        headingText = text;
      }
      if (text.trim())
        segments.push({
          text,
          anchor: rich ? block.id : heading,
          context: block.type === "heading" ? undefined : headingText || undefined,
        });
      if (block.children?.length) visit(block.children);
    }
  };
  visit(blocks);
  return segments;
}

function markdownSegments(content: string): Segment[] {
  const segments: Segment[] = [];
  let heading = "";
  let headingText = "";
  let fenced = false;
  content.split(/\r?\n/).forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const match = !fenced && /^#{1,6}\s+(.*)$/.exec(line);
    if (match) {
      headingText = match[1].trim();
      heading = headingSlug(headingText);
    }
    if (line.trim())
      segments.push({
        text: line,
        anchor: heading,
        line: index + 1,
        context: match ? undefined : headingText || undefined,
      });
  });
  return segments;
}

function lineSegments(content: string): Segment[] {
  return content
    .split(/\r?\n/)
    .map((text, index) => ({ text, anchor: "", line: index + 1 }))
    .filter((segment) => segment.text.trim());
}

/** What a person reads in each kind of file. */
export function extractSegments(path: string, raw: string, snapshot?: DocumentSnapshot): Segment[] {
  if (/\.excalidraw$/i.test(path)) {
    const data = JSON.parse(raw) as {
      elements?: Array<{
        id?: string;
        type?: string;
        text?: string;
        isDeleted?: boolean;
        link?: string;
      }>;
    };
    return (data.elements ?? [])
      .filter((element) => !element.isDeleted && element.type === "text" && element.text)
      .map((element) => ({ text: element.text!.replace(/\s+/g, " "), anchor: element.id ?? "" }));
  }
  if (/\.flow3d$/i.test(path)) {
    const data = JSON.parse(raw) as {
      nodes?: Array<{
        id?: string;
        label?: string;
        description?: string;
        config?: Record<string, unknown>;
      }>;
    };
    const segments: Segment[] = [];
    for (const node of data.nodes ?? []) {
      const anchor = node.id ?? "";
      if (node.label) segments.push({ text: node.label, anchor, context: "paso" });
      if (node.description) segments.push({ text: node.description, anchor, context: node.label });
      for (const [key, value] of Object.entries(node.config ?? {})) {
        if (typeof value === "string" && value.trim() && key !== "type")
          segments.push({
            text: value.replace(/\s+/g, " "),
            anchor,
            context: `${node.label ?? anchor} · ${key}`,
          });
      }
    }
    return segments;
  }
  if (/\.(note|md|markdown)$/i.test(path)) {
    const doc = snapshot ?? decodeDocument(path, raw);
    if (doc.blocks) return blockSegments(doc.blocks, isRichNote(path));
    return markdownSegments(doc.content);
  }
  return lineSegments(raw);
}

/** Matches of `matcher` in the segments, with a snippet around each one. */
export function findMatches(segments: Segment[], matcher: RegExp, limit: number): SearchMatch[] {
  const matches: SearchMatch[] = [];
  for (const segment of segments) {
    matcher.lastIndex = 0;
    let found: RegExpExecArray | null;
    while ((found = matcher.exec(segment.text)) && matches.length < limit) {
      if (found[0].length === 0) {
        matcher.lastIndex++;
        continue;
      }
      // Keep long lines readable: a window around the match.
      const from = Math.max(0, found.index - 60);
      const to = Math.min(segment.text.length, found.index + found[0].length + 120);
      const prefix = from > 0 ? "…" : "";
      matches.push({
        text: `${prefix}${segment.text.slice(from, to)}${to < segment.text.length ? "…" : ""}`,
        start: prefix.length + found.index - from,
        end: prefix.length + found.index - from + found[0].length,
        anchor: segment.anchor,
        line: segment.line,
        context: segment.context,
      });
    }
    if (matches.length >= limit) break;
  }
  return matches;
}

async function listFiles(root: string, maxFiles: number, signal: AbortSignal) {
  const files: string[] = [];
  const queue = [root];
  let truncated = false;
  while (queue.length > 0) {
    signal.throwIfAborted();
    const directory = queue.shift()!;
    let entries;
    try {
      entries = await readDir(directory);
    } catch (error) {
      if (directory === root) throw error;
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymlink || SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      const path = await join(directory, entry.name);
      if (entry.isDirectory) queue.push(path);
      else if (TEXT_FILES.test(entry.name)) {
        if (files.length >= maxFiles) {
          truncated = true;
          return { files, truncated };
        }
        files.push(path);
      }
    }
  }
  return { files, truncated };
}

/** Search the workspace. Open documents are searched as they are in the editor. */
export async function searchWorkspace(
  root: string,
  query: string,
  signal: AbortSignal,
  openDocuments: Record<string, DocumentSnapshot> = {},
  options: SearchOptions = {}
): Promise<SearchSummary> {
  const matcher = buildMatcher(query, options);
  const summary: SearchSummary = { files: [], total: 0, scanned: 0, truncated: false };
  if (!matcher) return summary;
  const maxResults = options.maxResults ?? 500;
  const listed = await listFiles(root, options.maxFiles ?? 3000, signal);
  summary.truncated = listed.truncated;
  for (let offset = 0; offset < listed.files.length; offset += 12) {
    signal.throwIfAborted();
    const batch = await Promise.all(
      listed.files.slice(offset, offset + 12).map(async (path) => {
        try {
          const open = openDocuments[path];
          if (!open) {
            const info = await stat(path).catch(() => null);
            if (info && info.size > MAX_FILE_BYTES) return null;
          }
          const raw = open ? "" : await readTextFile(path);
          const matches = findMatches(extractSegments(path, raw, open), matcher, 50);
          return matches.length > 0 ? { path, matches } : null;
        } catch {
          return null;
        }
      })
    );
    summary.scanned += batch.length;
    for (const result of batch) {
      if (!result) continue;
      summary.files.push(result);
      summary.total += result.matches.length;
    }
    if (summary.total >= maxResults) {
      summary.truncated = true;
      break;
    }
  }
  return summary;
}
