import { useState, useEffect } from "react";
import { getHomeDir } from "@/shared/lib/path";

/**
 * Returns the user's home directory path, resolved once and cached at module level.
 * Returns empty string while loading (safe to pass to tildify — no-op when empty).
 */
export function useHomeDir(): string {
  const [homeDir, setHomeDir] = useState("");

  useEffect(() => {
    getHomeDir()
      .then(setHomeDir)
      .catch(() => {});
  }, []);

  return homeDir;
}
