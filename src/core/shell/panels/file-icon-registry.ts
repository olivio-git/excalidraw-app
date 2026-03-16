import type React from "react";
import { FileText, PencilLine, FileCode, FileImage, FileJson } from "lucide-react";

type IconComponent = React.ComponentType<{ className?: string }>;

class FileIconRegistryClass {
  private readonly icons = new Map<string, IconComponent>();

  register(extension: string, icon: IconComponent): void {
    this.icons.set(extension.toLowerCase().replace(/^\./, ""), icon);
  }

  resolve(filename: string): IconComponent {
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    return this.icons.get(ext) ?? FileText;
  }
}

export const fileIconRegistry = new FileIconRegistryClass();

// Built-in defaults
fileIconRegistry.register("excalidraw", PencilLine);
fileIconRegistry.register("md", FileCode);
fileIconRegistry.register("mdx", FileCode);
fileIconRegistry.register("json", FileJson);
fileIconRegistry.register("png", FileImage);
fileIconRegistry.register("jpg", FileImage);
fileIconRegistry.register("jpeg", FileImage);
fileIconRegistry.register("svg", FileImage);
fileIconRegistry.register("webp", FileImage);
