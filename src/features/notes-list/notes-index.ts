import { readDir, readTextFile, stat } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import {
  decodeDocument,
  inlineText,
  type DocumentBlock,
} from "@/features/document-editor/note-format";

/**
 * Every note of the workspace for the Notes view (Inkdrop style): title,
 * a line of text, its folder as the notebook, when it changed, and the
 * `status` / `tags` from a Markdown front matter.
 */

export type NoteStatus = "active" | "onhold" | "completed" | "dropped";

export interface NoteSummary {
  path: string;
  title: string;
  snippet: string;
  /** Folder relative to the workspace ("" at the root). */
  notebook: string;
  /** Last change, ms since epoch (0 when unknown). */
  updated: number;
  tags: string[];
  status?: NoteStatus;
}

const NOTE_FILES = /\.(md|markdown|note)$/i;
const SKIP = new Set([".git", "node_modules", "dist", "build", "target", ".qori"]);
const STATUSES: Record<string, NoteStatus> = {
  active: "active",
  activo: "active",
  "on hold": "onhold",
  onhold: "onhold",
  "en pausa": "onhold",
  completed: "completed",
  done: "completed",
  completado: "completed",
  dropped: "dropped",
  descartado: "dropped",
};

/** `---\nkey: value\n---` at the top of a Markdown file. */
export function frontMatter(text: string): { data: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { data: {}, body: text };
  const data: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const item = /^([\w-]+)\s*:\s*(.*)$/.exec(line);
    if (item) data[item[1].toLowerCase()] = item[2].trim();
  }
  return { data, body: text.slice(match[0].length) };
}

const listValue = (value: string | undefined) =>
  (value ?? "")
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((v) => v.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);

const clean = (line: string) =>
  line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+(?:\[[ x]\]\s+)?/i, "")
    .replace(/[*_`>]/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim();

/** Title and first line of text of a note's content. */
export function summarize(
  path: string,
  raw: string
): Pick<NoteSummary, "title" | "snippet" | "tags" | "status"> {
  const fallback = (path.split(/[\\/]/).pop() ?? path).replace(/\.[^.]+$/, "");
  const doc = decodeDocument(path, raw);
  if (doc.blocks) {
    const texts: Array<{ text: string; heading: boolean }> = [];
    const visit = (blocks: DocumentBlock[]) => {
      for (const block of blocks) {
        const text = inlineText(block.content).trim();
        if (text) texts.push({ text, heading: block.type === "heading" });
        if (block.children?.length && texts.length < 6) visit(block.children);
        if (texts.length >= 6) return;
      }
    };
    visit(doc.blocks);
    const title = texts.find((t) => t.heading)?.text ?? texts[0]?.text ?? fallback;
    const snippet = texts.find((t) => t.text !== title)?.text ?? "";
    return { title, snippet: snippet.slice(0, 160), tags: [] };
  }
  const { data, body } = frontMatter(doc.content);
  const lines = body.split(/\r?\n/);
  let title = data.title?.replace(/^["']|["']$/g, "") ?? "";
  let snippet = "";
  let fenced = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || !line.trim()) continue;
    if (!title && /^#{1,6}\s/.test(line)) {
      title = clean(line);
      continue;
    }
    const text = clean(line);
    if (!text) continue;
    if (!title) {
      title = text;
      continue;
    }
    snippet = text;
    break;
  }
  const status = STATUSES[(data.status ?? "").toLowerCase()];
  return {
    title: title || fallback,
    snippet: snippet.slice(0, 160),
    tags: listValue(data.tags),
    status,
  };
}

/** Pinned first, then by date (newest) or title. */
export function sortNotes(
  notes: NoteSummary[],
  sort: "updated" | "title",
  pinned: string[] = []
): NoteSummary[] {
  const rank = (note: NoteSummary) => {
    const index = pinned.findIndex((p) =>
      note.path.replaceAll("\\", "/").endsWith(`/${p.replace(/^\.?\//, "")}`)
    );
    return index < 0 ? Infinity : index;
  };
  return [...notes].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (sort === "title"
        ? a.title.localeCompare(b.title)
        : b.updated - a.updated || a.title.localeCompare(b.title))
  );
}

export async function indexNotes(
  root: string,
  signal: AbortSignal,
  maxNotes = 2000
): Promise<NoteSummary[]> {
  const files: string[] = [];
  const queue = [root];
  while (queue.length > 0 && files.length < maxNotes) {
    signal.throwIfAborted();
    const dir = queue.shift()!;
    let entries;
    try {
      entries = await readDir(dir);
    } catch (error) {
      if (dir === root) throw error;
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymlink || SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
      const path = await join(dir, entry.name);
      if (entry.isDirectory) queue.push(path);
      else if (NOTE_FILES.test(entry.name)) files.push(path);
    }
  }
  const base = root.replaceAll("\\", "/").replace(/\/$/, "");
  const notes: NoteSummary[] = [];
  for (let offset = 0; offset < files.length; offset += 16) {
    signal.throwIfAborted();
    const batch = await Promise.all(
      files.slice(offset, offset + 16).map(async (path) => {
        try {
          const [raw, info] = await Promise.all([readTextFile(path), stat(path).catch(() => null)]);
          const relative = path.replaceAll("\\", "/").slice(base.length + 1);
          return {
            path,
            notebook: relative.includes("/") ? relative.replace(/\/[^/]*$/, "") : "",
            updated: info?.mtime ? new Date(info.mtime).getTime() : 0,
            ...summarize(path, raw),
          } satisfies NoteSummary;
        } catch {
          return null;
        }
      })
    );
    notes.push(...(batch.filter(Boolean) as NoteSummary[]));
  }
  return notes;
}
