import { useState } from "react";
import { copyFile, rename, stat } from "@tauri-apps/plugin-fs";
import { join, dirname, basename } from "@tauri-apps/api/path";
import { confirm } from "@/shared/lib/confirm";
import { notify } from "@/shared/lib/notify";
import { updateTabsAfterMove } from "@/core/shell/panels/explorer-tab-sync";
import type { ClipboardState, UseFileClipboardReturn } from "@/core/shell/panels/explorer-types";

// ---------------------------------------------------------------------------
// useFileClipboard — Cut / Copy / Paste for explorer nodes
// ---------------------------------------------------------------------------

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveDestPath(srcPath: string, destDir: string): Promise<string | null> {
  const name = await basename(srcPath);
  const candidate = await join(destDir, name);
  const exists = await fileExists(candidate);

  if (!exists) return candidate;

  // Conflict — ask user
  const ok = await confirm({
    title: "Conflicto de nombres",
    description: `Ya existe "${name}" en el destino. ¿Deseas reemplazarlo?`,
    confirmLabel: "Reemplazar",
    variant: "destructive",
  });

  return ok ? candidate : null;
}

export function useFileClipboard(onRefresh: () => Promise<void>): UseFileClipboardReturn {
  const [clipboardState, setClipboardState] = useState<ClipboardState>(null);

  const cut = (paths: string[]) => {
    setClipboardState({ op: "cut", paths });
  };

  const copy = (paths: string[]) => {
    setClipboardState({ op: "copy", paths });
  };

  const paste = async (targetDir: string) => {
    if (!clipboardState) return;

    const { op, paths } = clipboardState;
    let anySuccess = false;

    for (const srcPath of paths) {
      const destPath = await resolveDestPath(srcPath, targetDir);
      if (!destPath) continue; // user cancelled conflict

      const name = await basename(srcPath);

      try {
        if (op === "copy") {
          await copyFile(srcPath, destPath);
        } else {
          // cut = move (rename across dirs)
          const srcDir = await dirname(srcPath);
          if (srcDir !== targetDir) {
            await rename(srcPath, destPath);
            updateTabsAfterMove(srcPath, destPath);
          }
        }
        anySuccess = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        notify(`Error al pegar "${name}": ${msg}`, { type: "error" });
      }
    }

    if (anySuccess) {
      // After cut, clear clipboard; after copy, keep it (like most file managers)
      if (op === "cut") {
        setClipboardState(null);
      }
      await onRefresh();
    }
  };

  const isCut = (path: string): boolean => {
    return clipboardState?.op === "cut" && clipboardState.paths.includes(path);
  };

  const clear = () => {
    setClipboardState(null);
  };

  return {
    clipboardState,
    cut,
    copy,
    paste,
    isCut,
    clear,
  };
}
