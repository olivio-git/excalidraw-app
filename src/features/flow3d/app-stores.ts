import { createTauriStorage } from "@/core/storage/tauri-storage";
import { createRunHistory } from "./run-history";
import { createSecretStore } from "./secrets";

/** App-wide instances (Tauri store files in the app data folder). */
export const runHistory = createRunHistory(createTauriStorage("flow3d-history.json"));
export const flowSecrets = createSecretStore(createTauriStorage("flow3d-secrets.json"));
