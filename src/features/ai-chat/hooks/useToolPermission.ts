import { useAIPermissionStore } from "../store/ai-permission-store";
import { useAISettingsStore } from "@/features/settings/ai/ai-settings-store";
import { ALWAYS_ASK_TOOLS, isWriteTool, describeToolCall } from "../lib/tool-permission";
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
// ALWAYS_ASK_TOOLS (shell commands) skip (a)–(d): every call opens the dialog,
// and "allow always" counts as allow once for them.
//
// Pattern mirrors confirm.ts: Promise is constructed here, resolver is handed
// to the store's _show() method, which passes it to the dialog via state.
// ---------------------------------------------------------------------------

export function useToolPermission() {
  const checkPermission = (toolName: string, input: unknown): Promise<PermissionOutcome> => {
    // requireToolConfirmation is added in Phase 6 — cast to unknown map for forward-compat
    const settings = useAISettingsStore.getState() as unknown as Record<string, unknown>;
    const requireToolConfirmation = settings.requireToolConfirmation ?? true;

    // Shell commands: confirmed one by one, always.
    if (ALWAYS_ASK_TOOLS.has(toolName)) return ask(toolName, input);

    // (a) Setting disabled — auto-allow everything
    if (requireToolConfirmation === false) {
      return Promise.resolve<PermissionOutcome>({ decision: "auto-allow" });
    }

    // (b) Read-only tool — auto-allow
    if (!isWriteTool(toolName)) {
      return Promise.resolve<PermissionOutcome>({ decision: "auto-allow" });
    }

    const { allAllowed, getDecision, setAllAllowed } = useAIPermissionStore.getState();

    // (c) Session-wide allow all write tools
    if (allAllowed) {
      return Promise.resolve<PermissionOutcome>({ decision: "auto-allow" });
    }

    const cached = getDecision(toolName);

    // (d) Session-cached allow
    if (cached === "allowed") {
      return Promise.resolve<PermissionOutcome>({ decision: "auto-allow" });
    }

    // (e) Session-cached deny
    if (cached === "denied") {
      return Promise.resolve<PermissionOutcome>({ decision: "deny" });
    }

    // (f) No prior decision — open dialog, await user choice
    return ask(toolName, input).then((outcome) => {
      // "Allow always" means allow all write tools for this chat session.
      if (outcome.decision === "allow-always") setAllAllowed(true);
      return outcome;
    });
  };

  const ask = (toolName: string, input: unknown): Promise<PermissionOutcome> => {
    const description = describeToolCall(toolName, input);
    const request = { toolName, input, ...description };
    return new Promise<PermissionOutcome>((resolve) => {
      useAIPermissionStore.getState()._show(request, resolve);
    });
  };

  return { checkPermission };
}
