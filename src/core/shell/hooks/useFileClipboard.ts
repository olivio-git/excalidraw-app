import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { rename, lstat } from "@tauri-apps/plugin-fs";
import { dirname, basename } from "@tauri-apps/api/path";
import { notify } from "@/shared/lib/notify";
import { updateTabsAfterMove } from "@/core/shell/panels/explorer-tab-sync";
import {
  availableDestination,
  copyEntry,
  isSameOrDescendant,
  topLevelPaths,
} from "@/core/shell/panels/explorer-file-operations";
import type { ClipboardState, UseFileClipboardReturn } from "@/core/shell/panels/explorer-types";
import { prepareResourceMove } from "@/core/tabs/tab-lifecycle";

export function useFileClipboard(onRefresh: () => Promise<void>): UseFileClipboardReturn {
  const { t } = useTranslation("explorer");
  const [clipboardState, setClipboardState] = useState<ClipboardState>(null);
  const pasting = useRef(false);

  const cut = (paths: string[]) => setClipboardState({ op: "cut", paths: topLevelPaths(paths) });
  const copy = (paths: string[]) => setClipboardState({ op: "copy", paths: topLevelPaths(paths) });

  const paste = async (targetDir: string) => {
    if (!clipboardState || !targetDir || pasting.current) return;
    pasting.current = true;
    const { op, paths } = clipboardState;
    const failed: string[] = [];
    let changed = false;
    try {
      for (const source of paths) {
        try {
          if (isSameOrDescendant(targetDir, source)) throw new Error(t("clipboard.invalidTarget"));
          if (op === "cut" && (await dirname(source)) === targetDir) continue;
          const info = await lstat(source);
          const destination = await availableDestination(source, targetDir, info.isDirectory);
          if (op === "copy") await copyEntry(source, destination);
          else {
            await prepareResourceMove(source);
            await rename(source, destination);
            updateTabsAfterMove(source, destination);
          }
          changed = true;
        } catch (error) {
          failed.push(source);
          const name = await basename(source);
          notify(t("clipboard.errorPasting", { name, message: String(error) }), { type: "error" });
        }
      }
      if (op === "cut") {
        // Do not discard failed moves, or a newer clipboard captured during this operation.
        setClipboardState((current) =>
          current !== clipboardState ? current : failed.length ? { op, paths: failed } : null
        );
      }
      if (changed) await onRefresh();
    } finally {
      pasting.current = false;
    }
  };

  return {
    clipboardState,
    cut,
    copy,
    paste,
    isCut: (path) => clipboardState?.op === "cut" && clipboardState.paths.includes(path),
    clear: () => setClipboardState(null),
  };
}
