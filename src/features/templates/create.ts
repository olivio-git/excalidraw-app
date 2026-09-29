import { exists, writeTextFile } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { openFileInWorkbench } from "@/core/shell/services/file-navigation";
import { buildTemplate, type Template, type TemplateLang } from "./templates";

/** A file name that doesn't overwrite anything: "Acta.md", "Acta-2.md"… */
export async function freePath(dir: string, base: string, extension: string): Promise<string> {
  const clean = base.replace(/[\\/:*?"<>|]/g, "").trim() || "nuevo";
  for (let n = 1; n < 1000; n++) {
    const path = await join(dir, `${clean}${n === 1 ? "" : `-${n}`}.${extension}`);
    if (!(await exists(path).catch(() => false))) return path;
  }
  throw new Error("No hay un nombre libre para el archivo");
}

/** Write the template as a new file and open it. */
export async function createFromTemplate(
  template: Template,
  name: string,
  dir: string,
  language: TemplateLang
): Promise<string> {
  const path = await freePath(dir, name, template.extension);
  await writeTextFile(
    path,
    buildTemplate(template, language, name.trim() || template.title[language])
  );
  openFileInWorkbench(path);
  return path;
}
