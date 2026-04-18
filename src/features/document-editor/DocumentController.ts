import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/core/tabs/store/tab-store";
import type { DocumentAPI, Section } from "@/plugins/types";
import type { useDocumentStore } from "@/stores/documentStore";
import type { documentFileService } from "./documentFileService";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, "").trim();
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

/**
 * Parse markdown headings into Section objects.
 *
 * NOTE: Markdown round-trip for nested lists has known limitations in
 * BlockNote 0.47.x — documents with complex nested content may not
 * round-trip perfectly.
 */
function parseSections(content: string): Section[] {
  const lines = content.split("\n");
  const sections: Section[] = [];
  let currentHeading: { text: string; level: number; startLine: number } | null = null;
  let bodyLines: string[] = [];

  const flushSection = (_endLine: number) => {
    if (!currentHeading) return;
    const bodyContent = bodyLines.join("\n").trim();
    // Strip HTML tags from heading text before slugifying so that headings
    // with inline HTML (e.g. <span style="...">Title</span>) produce clean,
    // stable IDs like "h1-title" instead of "h1-span-stylecolor-...titlespan".
    const cleanText = stripHtml(currentHeading.text);
    const slug = slugify(cleanText);
    const base = `h${currentHeading.level}-${slug}`;

    // Count prior sections with the same heading text + level to handle duplicates.
    // Unique headings → stable id (e.g. "h2-diagrama-del-flujo").
    // Duplicates → disambiguate with occurrence suffix ("h2-intro", "h2-intro-2", "h2-intro-3").
    const priorSameHeading = sections.filter(
      (s) => s.heading === cleanText && s.level === currentHeading!.level
    ).length;
    const id = priorSameHeading === 0 ? base : `${base}-${priorSameHeading + 1}`;

    sections.push({
      id,
      heading: cleanText,
      level: currentHeading.level,
      content: bodyContent,
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushSection(i);
      currentHeading = {
        text: headingMatch[2].trim(),
        level: headingMatch[1].length,
        startLine: i,
      };
      bodyLines = [];
    } else if (currentHeading) {
      bodyLines.push(line);
    }
  }
  flushSection(lines.length);

  return sections;
}

/**
 * Replace the content block of a section identified by `sectionId`.
 * Returns the modified full content string.
 */
function replaceSectionContent(
  fullContent: string,
  sectionId: string,
  newBody: string,
  deleteMode = false
): string {
  const sections = parseSections(fullContent);
  const idx = sections.findIndex((s) => s.id === sectionId);
  if (idx === -1) return fullContent;

  const target = sections[idx];

  const targetOccurrence = sections
    .slice(0, idx)
    .filter((s) => s.heading === target.heading && s.level === target.level).length;

  // Locate the raw heading line in original content.
  // Compare against stripped text so headings with inline HTML (e.g. <span>)
  // are found correctly regardless of their raw markup.
  const lines = fullContent.split("\n");
  let sectionStart = -1;
  let sectionCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (m && m[1].length === target.level && stripHtml(m[2].trim()) === target.heading) {
      if (sectionCount === targetOccurrence) {
        sectionStart = i;
        break;
      }
      sectionCount++;
    }
  }

  if (sectionStart === -1) return fullContent;

  // Preserve the original heading line as-is (including any inline HTML).
  // We only replace the BODY, never the heading line itself.
  const originalHeadingLine = lines[sectionStart];

  // Find end of section body — stop at the NEXT heading of ANY level.
  // This makes replace/delete atomic: they only touch the immediate body text
  // between this heading and the next child/sibling heading, never the subtree.
  let sectionEnd = lines.length;
  for (let i = sectionStart + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i])) {
      sectionEnd = i;
      break;
    }
  }

  const before = lines.slice(0, sectionStart);
  const after = lines.slice(sectionEnd);

  if (deleteMode) {
    return [...before, ...after].join("\n");
  }

  return [...before, originalHeadingLine, newBody, ...after].join("\n");
}

// ---------------------------------------------------------------------------
// DocumentController
// ---------------------------------------------------------------------------

export class DocumentController implements DocumentAPI {
  constructor(
    private readonly store: typeof useDocumentStore,
    private readonly fileService: typeof documentFileService
  ) {}

  async createDocument(title: string): Promise<string> {
    const workspaceDir = useWorkspaceStore.getState().workspaceDir;
    if (!workspaceDir) throw new Error("No workspace directory set");
    const filePath = `${workspaceDir}/documents/${title}.md`;
    await this.fileService.writeDocumentFile(filePath, "");
    this.store.getState().openDocument(filePath, "");
    return filePath;
  }

  async openDocument(filePath: string): Promise<void> {
    // Task 2.9: Tab deduplication — only short-circuit if the document is BOTH
    // already in the store AND has a tab. If the tab exists but the document
    // isn't loaded yet (e.g. first open after ExplorerPanel created the tab),
    // we must still read the file and populate the store.
    const existingTab = useTabStore.getState().tabs.find((t) => t.instanceId === filePath);
    const documentAlreadyLoaded = !!this.store.getState().documents[filePath];
    if (existingTab && documentAlreadyLoaded) {
      useTabStore.getState().setActiveTab(existingTab.id);
      this.store.getState().setActive(filePath);
      return;
    }

    const content = await this.fileService.readDocumentFile(filePath);
    this.store.getState().openDocument(filePath, content);

    // Task 2.7: Sync tab title after opening.
    // Derive title from filename without extension (matches store logic).
    const title =
      filePath
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.[^.]+$/, "") ?? filePath;

    // Find the tab for this filePath — it was just added by openFile in plugin-api.ts
    // The tab uses instanceId = filePath (set by the file handler in index.ts).
    const tab = useTabStore.getState().tabs.find((t) => t.instanceId === filePath);
    if (tab && tab.title !== title) {
      useTabStore.getState().updateTab(tab.id, { title });
    }
  }

  getContent(filePath: string): string | null {
    return this.store.getState().documents[filePath]?.content ?? null;
  }

  getSections(filePath: string): Section[] {
    const content = this.getContent(filePath);
    if (content === null) return [];
    return parseSections(content);
  }

  async setContent(filePath: string, content: string): Promise<void> {
    this.store.getState().setExternalContent(filePath, content);
    await this.fileService.writeDocumentFile(filePath, content);
    this.store.getState().markSaved(filePath);
  }

  async appendContent(filePath: string, content: string): Promise<void> {
    const current = this.getContent(filePath) ?? "";
    await this.setContent(filePath, `${current}\n\n${content}`);
  }

  async insertAfterSection(filePath: string, sectionId: string, content: string): Promise<void> {
    const current = this.getContent(filePath);
    if (current === null) throw new Error(`Document not open: ${filePath}`);

    const sections = parseSections(current);
    const idx = sections.findIndex((s) => s.id === sectionId);
    if (idx === -1) throw new Error(`Section not found: ${sectionId}`);

    const target = sections[idx];
    const targetOccurrence = sections
      .slice(0, idx)
      .filter((s) => s.heading === target.heading && s.level === target.level).length;

    // Locate the heading line by index — same strategy as replaceSectionContent.
    const lines = current.split("\n");
    let sectionStart = -1;
    let sectionCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(#{1,6})\s+(.+)$/);
      if (m && m[1].length === target.level && stripHtml(m[2].trim()) === target.heading) {
        if (sectionCount === targetOccurrence) {
          sectionStart = i;
          break;
        }
        sectionCount++;
      }
    }

    if (sectionStart === -1) throw new Error(`Section heading not found in content: ${sectionId}`);

    // Find end of section body — stop at next heading of ANY level.
    let sectionEnd = lines.length;
    for (let i = sectionStart + 1; i < lines.length; i++) {
      if (/^#{1,6}\s/.test(lines[i])) {
        sectionEnd = i;
        break;
      }
    }

    // Splice the new content in after the section body.
    const before = lines.slice(0, sectionEnd);
    const after = lines.slice(sectionEnd);
    const updated = [...before, "", content, ...after].join("\n");
    await this.setContent(filePath, updated);
  }

  async insertAfterHeading(filePath: string, heading: string, content: string): Promise<void> {
    const current = this.getContent(filePath);
    if (current === null) throw new Error(`Document not open: ${filePath}`);

    const sections = parseSections(current);
    const target = sections.find((s) => s.heading === heading);
    if (!target) {
      // Heading not found — append to end of document instead
      return this.appendContent(filePath, content);
    }

    await this.insertAfterSection(filePath, target.id, content);
  }

  async replaceSection(filePath: string, sectionId: string, content: string): Promise<void> {
    const current = this.getContent(filePath);
    if (current === null) throw new Error(`Document not open: ${filePath}`);
    const updated = replaceSectionContent(current, sectionId, content, false);
    await this.setContent(filePath, updated);
  }

  async deleteSection(filePath: string, sectionId: string): Promise<void> {
    const current = this.getContent(filePath);
    if (current === null) throw new Error(`Document not open: ${filePath}`);
    const updated = replaceSectionContent(current, sectionId, "", true);
    await this.setContent(filePath, updated);
  }

  async insertDiagram(filePath: string, diagramPath: string, caption?: string): Promise<void> {
    const label = caption ?? diagramPath;
    await this.appendContent(filePath, `\n\n![${label}](${diagramPath})\n\n`);
  }

  async saveDocument(filePath: string): Promise<void> {
    const content = this.getContent(filePath);
    if (content === null) throw new Error("Document not open");
    await this.fileService.writeDocumentFile(filePath, content);
    this.store.getState().markSaved(filePath);
  }

  async listDocuments(): Promise<string[]> {
    const workspaceDir = useWorkspaceStore.getState().workspaceDir;
    if (!workspaceDir) {
      // Fall back to in-memory documents when no workspace is set
      return Object.keys(this.store.getState().documents);
    }
    try {
      return await this.fileService.listDocumentFiles(workspaceDir);
    } catch {
      // If readDir fails (e.g. dir not yet created), return in-memory list
      return Object.keys(this.store.getState().documents);
    }
  }

  async deleteDocument(filePath: string): Promise<void> {
    await this.fileService.deleteDocumentFile(filePath);
    this.store.getState().closeDocument(filePath);
  }
}
