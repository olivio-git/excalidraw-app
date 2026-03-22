import { useState } from "react";
import { useTranslation } from "react-i18next";
import { copyFile, rename, stat } from "@tauri-apps/plugin-fs";
import { join, dirname, basename } from "@tauri-apps/api/path";
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

/**
 * Resolve a non-colliding destination path.
 * If `destDir/srcName` already exists, appends " copy", " copy 2", etc.
 * until a free slot is found. No user confirmation needed.
 */
async function resolveDestPath(srcPath: string, destDir: string): Promise<string> {
  const name = await basename(srcPath);
  const dotIndex = name.lastIndexOf(".");
  const hasExt = dotIndex > 0;
  const ext = hasExt ? name.slice(dotIndex) : "";
  const base = hasExt ? name.slice(0, dotIndex) : name;

  // Try original name first
  let candidate = await join(destDir, name);
  if (!(await fileExists(candidate))) return candidate;

  // Try "base copy.ext", "base copy 2.ext", ...
  let i = 1;
  while (true) {
    const suffix = i === 1 ? " copy" : ` copy ${i}`;
    candidate = await join(destDir, `${base}${suffix}${ext}`);
    if (!(await fileExists(candidate))) return candidate;
    i++;
  }
}

export function useFileClipboard(onRefresh: () => Promise<void>): UseFileClipboardReturn {
  const { t } = useTranslation("explorer");
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
        notify(t("clipboard.errorPasting", { name, message: msg }), { type: "error" });
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
