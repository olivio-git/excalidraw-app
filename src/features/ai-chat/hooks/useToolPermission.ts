import { useAIPermissionStore } from "../store/ai-permission-store";
import { useAISettingsStore } from "@/features/settings/ai/ai-settings-store";
import { isWriteTool, describeToolCall } from "../lib/tool-permission";
import type { PermissionOutcome } from "../store/ai-permission-store";

// ---------------------------------------------------------------------------
// useToolPermission — permission gate hook
//
// Encapsulates the five-step resolution ladder:
//   (a) requireToolConfirmation === false → auto-allow
//   (b) !isWriteTool(toolName)           → auto-allow
//   (c) session cache "allowed"          → auto-allow
//   (d) session cache "denied"           → deny
//   (e) no session decision              → open dialog, await user choice
//
// Pattern mirrors confirm.ts: Promise is constructed here, resolver is handed
// to the store's _show() method, which passes it to the dialog via state.
// ---------------------------------------------------------------------------

export function useToolPermission() {
  const checkPermission = (toolName: string, input: unknown): Promise<PermissionOutcome> => {
    // requireToolConfirmation is added in Phase 6 — cast to unknown map for forward-compat
    const settings = useAISettingsStore.getState() as unknown as Record<string, unknown>;
    const requireToolConfirmation = settings.requireToolConfirmation ?? true;

    // (a) Setting disabled — auto-allow everything
    if (requireToolConfirmation === false) {
      return Promise.resolve<PermissionOutcome>({ decision: "auto-allow" });
    }

    // (b) Read-only tool — auto-allow
    if (!isWriteTool(toolName)) {
      return Promise.resolve<PermissionOutcome>({ decision: "auto-allow" });
    }

    const { getDecision, setDecision } = useAIPermissionStore.getState();
    const cached = getDecision(toolName);

    // (c) Session-cached allow
    if (cached === "allowed") {
      return Promise.resolve<PermissionOutcome>({ decision: "auto-allow" });
    }

    // (d) Session-cached deny
    if (cached === "denied") {
      return Promise.resolve<PermissionOutcome>({ decision: "deny" });
    }

    // (e) No prior decision — open dialog, await user choice
    const description = describeToolCall(toolName, input);
    const request = { toolName, input, ...description };

    return new Promise<PermissionOutcome>((resolve) => {
      useAIPermissionStore.getState()._show(request, (outcome) => {
        // Write session cache for "allow-always" decisions only
        if (outcome.decision === "allow-always") {
          setDecision(toolName, "allowed");
        }
        resolve(outcome);
      });
    });
  };

  return { checkPermission };
}
