import type { CompletionSource } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";

/**
 * Extension point of the code editor: other features (the extension host's
 * language bridge) add CodeMirror extensions and completion sources per
 * document and follow the document lifecycle (open/change/save/close), like
 * VS Code's `workspace.onDidOpenTextDocument` & co.
 */

export interface CodeDocument {
  /** Absolute file path; also the document's identity. */
  filePath: string;
  languageId: string;
  /** Incremented on every change, starting at 1. */
  version: number;
  getText(): string;
}

export interface TextPosition {
  /** 0-based, like VS Code. */
  line: number;
  /** UTF-16 offset within the line. */
  character: number;
}

export interface ContentChange {
  range: { start: TextPosition; end: TextPosition };
  text: string;
}

export interface EditorSelection {
  anchor: TextPosition;
  active: TextPosition;
}

export interface CodeEditorContribution {
  id: string;
  extensions?(doc: CodeDocument): Extension[];
  completionSources?(doc: CodeDocument): CompletionSource[];
  onDidOpen?(doc: CodeDocument): void;
  /** `changes` apply in order, each relative to the text after the previous one. */
  onDidChange?(doc: CodeDocument, changes: ContentChange[]): void;
  onDidChangeSelection?(doc: CodeDocument, selections: EditorSelection[]): void;
  onDidSave?(doc: CodeDocument): void;
  onDidClose?(doc: CodeDocument): void;
  onDidFocus?(doc: CodeDocument | null): void;
}

type Listener = () => void;

class EditorContributionRegistry {
  private contributions: CodeEditorContribution[] = [];
  private listeners = new Set<Listener>();
  private openDocuments = new Map<string, CodeDocument>();
  private activeDocument: CodeDocument | null = null;

  register(contribution: CodeEditorContribution): () => void {
    this.contributions = [
      ...this.contributions.filter((c) => c.id !== contribution.id),
      contribution,
    ];
    // Late registrations (the extension host starts after files are open)
    // still hear about the documents that are already open.
    for (const doc of this.openDocuments.values()) contribution.onDidOpen?.(doc);
    if (this.activeDocument) contribution.onDidFocus?.(this.activeDocument);
    this.emit();
    return () => {
      this.contributions = this.contributions.filter((c) => c !== contribution);
      this.emit();
    };
  }

  getAll(): CodeEditorContribution[] {
    return this.contributions;
  }

  getOpenDocuments(): CodeDocument[] {
    return [...this.openDocuments.values()];
  }

  getActiveDocument(): CodeDocument | null {
    return this.activeDocument;
  }

  private each(fn: (contribution: CodeEditorContribution) => void): void {
    for (const contribution of this.contributions) {
      try {
        fn(contribution);
      } catch (error) {
        console.error(`[code-editor] contribution ${contribution.id} failed`, error);
      }
    }
  }

  didOpen(doc: CodeDocument): void {
    this.openDocuments.set(doc.filePath, doc);
    this.each((c) => c.onDidOpen?.(doc));
  }

  didChange(doc: CodeDocument, changes: ContentChange[] = []): void {
    this.each((c) => c.onDidChange?.(doc, changes));
  }

  didChangeSelection(doc: CodeDocument, selections: EditorSelection[]): void {
    this.each((c) => c.onDidChangeSelection?.(doc, selections));
  }

  didSave(doc: CodeDocument): void {
    this.each((c) => c.onDidSave?.(doc));
  }

  didClose(doc: CodeDocument): void {
    this.openDocuments.delete(doc.filePath);
    if (this.activeDocument?.filePath === doc.filePath) this.didFocus(null);
    this.each((c) => c.onDidClose?.(doc));
  }

  didFocus(doc: CodeDocument | null): void {
    if (this.activeDocument === doc) return;
    this.activeDocument = doc;
    this.each((c) => c.onDidFocus?.(doc));
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}

export const editorContributions = new EditorContributionRegistry();
