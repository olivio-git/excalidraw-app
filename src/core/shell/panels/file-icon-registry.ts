import type React from "react";
import { FileText, FileCode, FileImage, FileJson } from "lucide-react";
import { ExcalidrawFileIcon } from "@/shared/icons/ExcalidrawFileIcon";

type IconComponent = React.ComponentType<{ className?: string }>;

export interface IconEntry {
  icon: IconComponent;
  colorClass: string;
}

class FileIconRegistryClass {
  private readonly icons = new Map<string, IconEntry>();

  register(extension: string, icon: IconComponent, colorClass = "text-slate-400"): void {
    this.icons.set(extension.toLowerCase().replace(/^\./, ""), { icon, colorClass });
  }

  resolve(filename: string): IconEntry {
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    return this.icons.get(ext) ?? { icon: FileText, colorClass: "text-slate-400" };
  }
}

export const fileIconRegistry = new FileIconRegistryClass();

// Built-in defaults
fileIconRegistry.register("excalidraw", ExcalidrawFileIcon, ""); // color baked into SVG
fileIconRegistry.register("md", FileCode, "text-blue-400");
fileIconRegistry.register("mdx", FileCode, "text-blue-400");
fileIconRegistry.register("json", FileJson, "text-yellow-400");
fileIconRegistry.register("png", FileImage, "text-purple-400");
fileIconRegistry.register("jpg", FileImage, "text-purple-400");
fileIconRegistry.register("jpeg", FileImage, "text-purple-400");
fileIconRegistry.register("svg", FileImage, "text-orange-400");
fileIconRegistry.register("webp", FileImage, "text-purple-400");
