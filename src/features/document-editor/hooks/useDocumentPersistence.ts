import { useState, useEffect, useRef } from "react";
import { useDocumentStore } from "@/stores/documentStore";
import { getDocumentController } from "../documentController.singleton";

/** Debounce content revisions, and keep edits made during an in-flight save dirty. */
export function useDocumentPersistence(filePath: string) {
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paused = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [resumeVersion, setResumeVersion] = useState(0);
  const revision = useDocumentStore((state) => state.documents[filePath]?.revision);
  const isDirty = useDocumentStore((state) => state.documents[filePath]?.isDirty ?? false);
  const lastSavedAt = useDocumentStore((state) => state.documents[filePath]?.lastSavedAt ?? null);
  useEffect(() => {
    if (!isDirty || paused.current) return;
    let current = true;
    const timer = setTimeout(async () => {
      if (paused.current) return;
      setIsSaving(true);
      setError(null);
      try {
        await getDocumentController().saveDocument(filePath);
      } catch (reason) {
        if (current) setError(String(reason));
      } finally {
        if (current) setIsSaving(false);
      }
    }, 1500);
    timerRef.current = timer;
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [filePath, revision, isDirty, resumeVersion]);
  return {
    isSaving: isDirty && isSaving,
    lastSavedAt,
    error,
    pause: () => {
      paused.current = true;
      clearTimeout(timerRef.current);
      return () => {
        paused.current = false;
        setResumeVersion((value) => value + 1);
      };
    },
  };
}
