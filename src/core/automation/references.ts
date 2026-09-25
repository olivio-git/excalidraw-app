import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useDocumentStore } from "@/stores/documentStore";
import {
  scanWorkspaceReferences,
  referencePathKey,
  type ReferenceIndex,
} from "@/core/shell/services/workspace-references";
import { AutomationError, integer, workspacePath } from "./validation";

const STATUS = { RUNNING: "running", READY: "ready", FAILED: "failed" } as const;
interface ReferenceJob {
  id: string;
  workspace: string;
  status: (typeof STATUS)[keyof typeof STATUS];
  startedAt: number;
  completedAt?: number;
  index?: ReferenceIndex;
  error?: string;
  controller: AbortController;
}
export interface ReferenceQuery {
  filePath: string;
  direction?: "incoming" | "outgoing" | "both";
  offset?: number;
  limit?: number;
  jobId?: string;
}
let job: ReferenceJob | undefined;

function currentJob() {
  if (job && job.workspace !== useWorkspaceStore.getState().workspaceDir) {
    job.controller.abort();
    job = undefined;
  }
  return job;
}
export const referenceActions = {
  getState() {
    const current = currentJob();
    return current
      ? {
          jobId: current.id,
          workspaceDir: current.workspace,
          status: current.status,
          startedAt: current.startedAt,
          completedAt: current.completedAt,
          files: current.index?.files ?? 0,
          failures: current.index?.failures ?? 0,
          truncated: current.index?.truncated ?? false,
          error: current.error,
        }
      : { status: "idle" as const, workspaceDir: useWorkspaceStore.getState().workspaceDir };
  },
  refresh(maxFiles = 1000) {
    integer(maxFiles, "maxFiles", 1, 1000);
    const root = useWorkspaceStore.getState().workspaceDir;
    if (!root) throw new AutomationError("NO_WORKSPACE", "Open a workspace folder first.");
    job?.controller.abort();
    const current: ReferenceJob = {
      id: crypto.randomUUID(),
      workspace: root,
      status: STATUS.RUNNING,
      startedAt: Date.now(),
      controller: new AbortController(),
    };
    job = current;
    void scanWorkspaceReferences(
      root,
      useDocumentStore.getState().documents,
      current.controller.signal,
      maxFiles
    )
      .then((index) => {
        if (currentJob() !== current || current.controller.signal.aborted) return;
        current.index = index;
        current.status = STATUS.READY;
        current.completedAt = Date.now();
      })
      .catch((error: unknown) => {
        if (currentJob() !== current || current.controller.signal.aborted) return;
        current.error = String(error);
        current.status = STATUS.FAILED;
        current.completedAt = Date.now();
      });
    return referenceActions.getState();
  },
  async query(input: ReferenceQuery) {
    const path = await workspacePath(input.filePath);
    const direction = input.direction ?? "both";
    if (!["incoming", "outgoing", "both"].includes(direction))
      throw new AutomationError("INVALID_INPUT", "Invalid reference direction.");
    const offset = integer(input.offset ?? 0, "offset"),
      limit = integer(input.limit ?? 100, "limit", 1, 200);
    if (!currentJob()) referenceActions.refresh();
    const current = currentJob()!;
    if (input.jobId && input.jobId !== current.id)
      throw new AutomationError("STALE_JOB", "The index was refreshed. Use the current jobId.");
    const key = referencePathKey(path);
    const refs =
      current.index?.references.filter((ref) =>
        direction === "incoming"
          ? referencePathKey(ref.targetPath) === key
          : direction === "outgoing"
            ? referencePathKey(ref.sourcePath) === key
            : referencePathKey(ref.sourcePath) === key || referencePathKey(ref.targetPath) === key
      ) ?? [];
    return {
      ...referenceActions.getState(),
      filePath: path,
      direction,
      total: refs.length,
      offset,
      hasMore: offset + limit < refs.length,
      references: structuredClone(refs.slice(offset, offset + limit)),
    };
  },
  dispose() {
    job?.controller.abort();
    job = undefined;
  },
};
