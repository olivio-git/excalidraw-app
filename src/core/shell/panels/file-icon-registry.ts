import * as React from "react";
import vscodeIcons from "@iconify-json/vscode-icons/icons.json";
import { FileText, FileCode, FileImage, FileJson, NotebookPen } from "lucide-react";
import { ExcalidrawFileIcon } from "@/shared/icons/ExcalidrawFileIcon";
import { getVsixIconForFile } from "@/plugins/vsix-icon-themes";

type IconComponent = React.ComponentType<{ className?: string }>;

export interface IconEntry {
  icon: IconComponent;
  colorClass: string;
}

type VscodeIconName = keyof typeof vscodeIcons.icons;

const VscodeIcon = (name: VscodeIconName): IconComponent => {
  const body = vscodeIcons.icons[name]?.body;
  return ({ className }) =>
    body
      ? React.createElement("svg", {
          className,
          viewBox: "0 0 32 32",
          role: "img",
          "aria-hidden": true,
          dangerouslySetInnerHTML: { __html: body },
        })
      : React.createElement(FileText, { className });
};

class FileIconRegistryClass {
  private readonly icons = new Map<string, IconEntry>();
  private readonly filenames = new Map<string, IconEntry>();

  register(extension: string, icon: IconComponent, colorClass = "text-slate-400"): void {
    this.icons.set(extension.toLowerCase().replace(/^\./, ""), { icon, colorClass });
  }

  registerFilename(filename: string, icon: IconComponent): void {
    this.filenames.set(filename.toLowerCase(), { icon, colorClass: "" });
  }

  resolve(filename: string): IconEntry {
    const installedIcon = getVsixIconForFile(filename);
    if (installedIcon) {
      const Icon: IconComponent = ({ className }) =>
        React.createElement("img", {
          src: installedIcon,
          className,
          alt: "",
          "aria-hidden": true,
        });
      return { icon: Icon, colorClass: "" };
    }
    const exact = this.filenames.get(filename.toLowerCase());
    if (exact) return exact;
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    return this.icons.get(ext) ?? { icon: FileText, colorClass: "text-slate-400" };
  }
}

export const fileIconRegistry = new FileIconRegistryClass();

// Built-in defaults
fileIconRegistry.register("excalidraw", ExcalidrawFileIcon, ""); // color baked into SVG
fileIconRegistry.register("md", FileCode, "text-blue-400");
fileIconRegistry.register("note", NotebookPen, "text-violet-400");
fileIconRegistry.register("mdx", FileCode, "text-blue-400");
fileIconRegistry.register("json", FileJson, "text-yellow-400");
fileIconRegistry.register("png", FileImage, "text-purple-400");
fileIconRegistry.register("jpg", FileImage, "text-purple-400");
fileIconRegistry.register("jpeg", FileImage, "text-purple-400");
fileIconRegistry.register("svg", FileImage, "text-orange-400");
fileIconRegistry.register("webp", FileImage, "text-purple-400");

// VS Code-compatible file icons from the open vscode-icons distribution.
const vscodeFileIcons: Record<string, VscodeIconName> = {
  ts: "file-type-typescript",
  tsx: "file-type-reactts",
  js: "file-type-js",
  jsx: "file-type-reactjs",
  css: "file-type-css",
  html: "file-type-html",
  yaml: "file-type-yaml",
  yml: "file-type-yaml",
  xml: "file-type-xml",
  sh: "file-type-shell",
  rs: "file-type-rust",
  py: "file-type-python",
  go: "file-type-go",
  sql: "file-type-sql",
  lock: "file-type-lock",
};
for (const [extension, iconName] of Object.entries(vscodeFileIcons)) {
  fileIconRegistry.register(extension, VscodeIcon(iconName), "");
}
for (const [filename, iconName] of Object.entries({
  "package.json": "file-type-node",
  "tsconfig.json": "file-type-tsconfig",
  "vite.config.ts": "file-type-vite",
  dockerfile: "file-type-docker",
  "readme.md": "file-type-markdown",
} satisfies Record<string, VscodeIconName>)) {
  fileIconRegistry.registerFilename(filename, VscodeIcon(iconName));
}
