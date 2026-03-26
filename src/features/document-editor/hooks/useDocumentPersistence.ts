import { useState, useEffect, useRef } from "react";
import { useDocumentStore } from "@/stores/documentStore";
import { getDocumentController } from "../documentController.singleton";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UseDocumentPersistenceResult {
  isSaving: boolean;
  lastSavedAt: number | null;
}

// ---------------------------------------------------------------------------
// useDocumentPersistence
//
// Auto-save hook with 1500ms debounce.
// Watches isDirty for the given filePath and triggers a save after the
// debounce window expires. Cleans up the timer on unmount.
// ---------------------------------------------------------------------------

const AUTOSAVE_DEBOUNCE_MS = 1500;

export function useDocumentPersistence(filePath: string): UseDocumentPersistenceResult {
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  const isDirty = useDocumentStore((s) => s.documents[filePath]?.isDirty ?? false);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSavingRef = useRef(false);

  useEffect(() => {
    // Don't queue a new debounce if already saving or doc is clean
    if (!isDirty || isSavingRef.current) return;

    // Cancel any pending debounce
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(async () => {
      isSavingRef.current = true;
      setIsSaving(true);

      try {
        await getDocumentController().saveDocument(filePath);
        setLastSavedAt(Date.now());
      } catch (err) {
        console.error("[useDocumentPersistence] Auto-save failed:", err);
      } finally {
        isSavingRef.current = false;
        setIsSaving(false);
      }
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [isDirty, filePath]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return { isSaving, lastSavedAt };
}
