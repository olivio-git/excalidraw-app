import { readDir, readTextFile } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import {
  decodeDocument,
  inlineText,
  isRichNote,
  type DocumentBlock,
  type DocumentSnapshot,
} from "@/features/document-editor/note-format";
import { isLocalFileReference, resolveFileReference } from "./file-navigation";

export interface WorkspaceReference {
  sourcePath: string;
  sourceAnchor: string;
  targetPath: string;
  targetAnchor: string;
  label: string;
}
export interface ReferenceIndex {
  references: WorkspaceReference[];
  files: number;
  failures: number;
  truncated: boolean;
}
interface RawReference {
  href: string;
  anchor: string;
  label: string;
}

export const referencePathKey = (path: string) => path.replaceAll("\\", "/");
export const headingSlug = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");

function linksIn(value: unknown, result: Set<string>) {
  if (Array.isArray(value)) {
    value.forEach((item) => linksIn(item, result));
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    if (
      ["href", "url", "link", "diagramPath"].includes(key) &&
      typeof child === "string" &&
      child &&
      isLocalFileReference(child)
    )
      result.add(child);
    else if (typeof child === "object") linksIn(child, result);
  }
}

export function referencesInBlocks(blocks: DocumentBlock[], stableIds: boolean): RawReference[] {
  const result: RawReference[] = [];
  let heading = "";
  const visit = (items: DocumentBlock[]) => {
    for (const block of items) {
      const label = inlineText(block.content);
      if (block.type === "heading") heading = headingSlug(label);
      const links = new Set<string>();
      linksIn(block.content, links);
      linksIn(block.props, links);
      for (const href of links)
        result.push({ href, anchor: stableIds ? block.id : heading, label: label.slice(0, 120) });
      if (block.children?.length) visit(block.children);
    }
  };
  visit(blocks);
  return result;
}

export async function extractFileReferences(
  path: string,
  raw: string,
  snapshot?: DocumentSnapshot
): Promise<RawReference[]> {
  if (/\.excalidraw$/i.test(path)) {
    const data = JSON.parse(raw) as {
      elements?: { id?: string; link?: string; text?: string; isDeleted?: boolean }[];
    };
    if (!Array.isArray(data.elements)) throw new Error("Invalid diagram");
    return data.elements
      .filter((element) => !element.isDeleted && element.link && isLocalFileReference(element.link))
      .map((element) => ({
        href: element.link!,
        anchor: element.id ?? "",
        label: element.text ?? "",
      }));
  }
  const doc = snapshot ?? decodeDocument(path, raw);
  if (doc.blocks) return referencesInBlocks(doc.blocks, isRichNote(path));
  const { getDocumentCodec } = await import("@/features/document-editor/note-codec");
  return referencesInBlocks(getDocumentCodec().tryParseMarkdownToBlocks(doc.content), false);
}

/** A bounded, cancelable workspace scan. Open buffers override disk content. */
export async function scanWorkspaceReferences(
  root: string,
  openDocuments: Record<string, DocumentSnapshot>,
  signal: AbortSignal,
  maxFiles = 1000
): Promise<ReferenceIndex> {
  const result: ReferenceIndex = { references: [], files: 0, failures: 0, truncated: false };
  const queue = [root];
  const files: string[] = [];
  let directories = 0;
  while (queue.length) {
    signal.throwIfAborted();
    const directory = queue.shift()!;
    if (++directories > 5000 || files.length >= maxFiles) {
      result.truncated = true;
      break;
    }
    try {
      for (const entry of await readDir(directory)) {
        if (entry.isSymlink || [".git", "node_modules"].includes(entry.name)) continue;
        const path = await join(directory, entry.name);
        if (entry.isDirectory) queue.push(path);
        else if (/\.(md|note|excalidraw)$/i.test(entry.name)) {
          if (files.length >= maxFiles) {
            result.truncated = true;
            break;
          }
          files.push(path);
        }
      }
    } catch (error) {
      if (directory === root) throw error;
      result.failures++;
    }
  }
  for (let offset = 0; offset < files.length; offset += 8) {
    signal.throwIfAborted();
    const batches = await Promise.all(
      files.slice(offset, offset + 8).map(async (path) => {
        try {
          const doc = openDocuments[path];
          const refs = await extractFileReferences(path, doc ? "" : await readTextFile(path), doc);
          const resolved: WorkspaceReference[] = [];
          for (const ref of refs) {
            signal.throwIfAborted();
            try {
              const target = await resolveFileReference(ref.href, path, root);
              if (!/\.(md|note|excalidraw)$/i.test(target.filePath)) continue;
              resolved.push({
                sourcePath: path,
                sourceAnchor: ref.anchor,
                targetPath: target.filePath,
                targetAnchor: target.anchor,
                label: ref.label,
              });
            } catch {
              /* Invalid authored links do not hide valid references from the same file. */
            }
          }
          return { resolved, failed: false };
        } catch {
          return { resolved: [], failed: true };
        }
      })
    );
    signal.throwIfAborted();
    for (const batch of batches) {
      if (batch.failed) result.failures++;
      else result.files++;
      result.references.push(...batch.resolved);
    }
  }
  return result;
}
