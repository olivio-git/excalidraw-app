import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { dirname } from "@tauri-apps/api/path";
import { rename, lstat } from "@tauri-apps/plugin-fs";
import { notify } from "@/shared/lib/notify";
import type { DragData } from "@/core/shell/panels/explorer-types";
import { updateTabsAfterMove } from "@/core/shell/panels/explorer-tab-sync";
import { prepareResourceMove } from "@/core/tabs/tab-lifecycle";
import {
  availableDestination,
  isSameOrDescendant,
  topLevelPaths,
} from "@/core/shell/panels/explorer-file-operations";

// Re-export DndContext so ExplorerPanel can use it without importing @dnd-kit/core directly
export { DndContext };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface UseDragAndDropReturn {
  draggingPath: string | null;
  overFolderPath: string | null;
  sensors: ReturnType<typeof useSensors>;
  handleDragStart: (event: DragStartEvent) => void;
  handleDragOver: (folderId: string | null) => void;
  handleDragEnd: (event: DragEndEvent, onRefresh: () => Promise<void>) => Promise<void>;
  handleDragCancel: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDragAndDrop(): UseDragAndDropReturn {
  const { t } = useTranslation("explorer");
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [overFolderPath, setOverFolderPath] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as DragData | undefined;
    if (data) {
      setDraggingPath(data.path);
    }
  };

  const handleDragOver = (folderId: string | null) => {
    setOverFolderPath(folderId);
  };

  const handleDragEnd = async (event: DragEndEvent, onRefresh: () => Promise<void>) => {
    setDraggingPath(null);
    setOverFolderPath(null);

    const { active, over } = event;
    if (!over) return;

    const srcData = active.data.current as DragData | undefined;
    if (!srcData) return;

    const destDirPath = over.id as string;
    const srcPath = srcData.path;

    // Paths to move — if multi-selected, move all selected; otherwise just the dragged item
    const pathsToMove =
      srcData.selectedPaths.length > 1 && srcData.selectedPaths.includes(srcPath)
        ? srcData.selectedPaths
        : [srcPath];

    for (const pathToMove of topLevelPaths(pathsToMove)) {
      const name = pathToMove.split("/").pop() ?? pathToMove;
      try {
        if ((await dirname(pathToMove)) === destDirPath) continue;
        if (isSameOrDescendant(destDirPath, pathToMove)) continue;
        const info = await lstat(pathToMove);
        const newPath = await availableDestination(pathToMove, destDirPath, info.isDirectory);
        await prepareResourceMove(pathToMove);
        await rename(pathToMove, newPath);
        updateTabsAfterMove(pathToMove, newPath);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        notify(t("dragDrop.errorMoving", { name, message: msg }), { type: "error" });
      }
    }

    await onRefresh();
  };

  const handleDragCancel = () => {
    setDraggingPath(null);
    setOverFolderPath(null);
  };

  return {
    draggingPath,
    overFolderPath,
    sensors,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  };
}
