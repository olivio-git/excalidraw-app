import { diagramFileService } from "@/core/diagram/services/diagram-file.service";

export interface FileHandler {
  /** Route to open when the file is clicked */
  routeId: string;
  /** Default extension (without dot) used when creating a new file of this type */
  defaultExtension: string;
  /** Creates a new file and returns its absolute path */
  create: (dir: string, name: string) => Promise<string>;
  /** Strip the extension from the display name (defaults to removing `.{ext}`) */
  displayName?: (filename: string) => string;
}

/** Picks a handler for files no extension-specific handler claims (e.g. any text file). */
export type FileHandlerResolver = (filename: string) => FileHandler | null;

class FileHandlerRegistryClass {
  private readonly handlers = new Map<string, FileHandler>();
  private fallbackResolver: FileHandlerResolver | null = null;
  private fallback: FileHandler = {
    routeId: "diagram",
    defaultExtension: "excalidraw",
    create: (dir, name) => diagramFileService.createNewDiagram(dir, name),
  };

  register(extension: string, handler: FileHandler): void {
    this.handlers.set(extension.toLowerCase().replace(/^\./, ""), handler);
  }

  resolve(filename: string): FileHandler | null {
    const ext = filename.includes(".") ? (filename.split(".").pop()?.toLowerCase() ?? "") : "";
    return this.handlers.get(ext) ?? this.fallbackResolver?.(filename) ?? null;
  }

  setFallbackResolver(resolver: FileHandlerResolver | null): void {
    this.fallbackResolver = resolver;
  }

  resolveOrDefault(filename: string): FileHandler {
    return this.resolve(filename) ?? this.fallback;
  }

  getDefault(): FileHandler {
    return this.fallback;
  }

  setDefault(handler: FileHandler): void {
    this.fallback = handler;
  }
}

export const fileHandlerRegistry = new FileHandlerRegistryClass();

// Built-in: Excalidraw
fileHandlerRegistry.register("excalidraw", {
  routeId: "diagram",
  defaultExtension: "excalidraw",
  create: (dir, name) => diagramFileService.createNewDiagram(dir, name),
  displayName: (filename) => filename.replace(/\.excalidraw$/, ""),
});
