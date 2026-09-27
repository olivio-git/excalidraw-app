import { normalize } from "@tauri-apps/api/path";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { EditorGroupId } from "@/core/tabs/types";

export class AutomationError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.details = details;
  }
}
export const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0"))
    throw new AutomationError("INVALID_INPUT", `${field} must be a non-empty string.`);
  return value;
}
export function group(value: unknown): EditorGroupId {
  if (value !== "primary" && value !== "secondary")
    throw new AutomationError("INVALID_INPUT", "groupId must be primary or secondary.");
  return value;
}
export function integer(
  value: unknown,
  field: string,
  min = 0,
  max = Number.MAX_SAFE_INTEGER
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)
    throw new AutomationError(
      "INVALID_INPUT",
      `${field} must be an integer between ${min} and ${max}.`
    );
  return value;
}
export function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean")
    throw new AutomationError("INVALID_INPUT", `${field} must be boolean.`);
  return value;
}
export function pathKey(path: string): string {
  const key = path.replaceAll("\\", "/").replace(/\/$/, "");
  return /^[a-z]:\//i.test(key) ? key.toLowerCase() : key;
}
export function isWorkspacePath(path: string, root: string): boolean {
  if (!/^(\/|[a-z]:[\\/])/i.test(path) || path.split(/[\\/]/).includes("..")) return false;
  const key = pathKey(path),
    parent = pathKey(root);
  return key === parent || key.startsWith(`${parent}/`);
}
export async function workspacePath(value: unknown, field = "filePath"): Promise<string> {
  const raw = text(value, field);
  const root = useWorkspaceStore.getState().workspaceDir;
  if (!root) throw new AutomationError("NO_WORKSPACE", "Open a workspace folder first.");
  if (!isWorkspacePath(raw, root))
    throw new AutomationError(
      "OUTSIDE_WORKSPACE",
      `${field} must be an absolute path inside the workspace.`
    );
  const path = await normalize(raw);
  if (!isWorkspacePath(path, await normalize(root)))
    throw new AutomationError("OUTSIDE_WORKSPACE", "Path is outside the workspace.");
  return path;
}
