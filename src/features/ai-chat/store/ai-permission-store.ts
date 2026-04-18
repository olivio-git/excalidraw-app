import { create } from "zustand";
import type { ToolCallDescription } from "../lib/tool-permission";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionDecision = "allowed" | "denied";

export type PermissionOutcome =
  | { decision: "allow-once" }
  | { decision: "allow-always" }
  | { decision: "deny" }
  | { decision: "auto-allow" };

export interface PermissionRequest extends ToolCallDescription {
  toolName: string;
  input: unknown;
}

// ---------------------------------------------------------------------------
// Store state shape
// ---------------------------------------------------------------------------

interface AIPermissionState {
  // ── Session decision cache ──
  decisions: Map<string, SessionDecision>;
  getDecision: (toolName: string) => SessionDecision | undefined;
  setDecision: (toolName: string, decision: SessionDecision) => void;
  reset: () => void;

  // ── Dialog gate ──
  open: boolean;
  request: PermissionRequest | null;
  resolver: ((outcome: PermissionOutcome) => void) | null;

  _show: (request: PermissionRequest, resolver: (outcome: PermissionOutcome) => void) => void;
  _settle: (outcome: PermissionOutcome) => void;
  _cancel: () => void;
}

// ---------------------------------------------------------------------------
// Store — dual-purpose: decision map + Promise-gate dialog
// Same architectural pattern as confirm.tsx / prompt.tsx (mount-once + store)
// No persist middleware — session store is intentionally ephemeral
// ---------------------------------------------------------------------------

export const useAIPermissionStore = create<AIPermissionState>()((set, get) => ({
  // ── Session decision cache ──
  decisions: new Map(),

  getDecision: (toolName) => get().decisions.get(toolName),

  setDecision: (toolName, decision) =>
    set((state) => {
      const next = new Map(state.decisions);
      next.set(toolName, decision);
      return { decisions: next };
    }),

  reset: () => set({ decisions: new Map(), open: false, request: null, resolver: null }),

  // ── Dialog gate ──
  open: false,
  request: null,
  resolver: null,

  _show: (request, resolver) => set({ open: true, request, resolver }),

  _settle: (outcome) => {
    const { resolver } = get();
    resolver?.(outcome);
    set({ open: false, request: null, resolver: null });
  },

  // Cancel: called by cancelStream() — forces deny-once so the agentic loop
  // catch block (AbortError) takes over cleanly. No session cache written.
  _cancel: () => {
    const { resolver } = get();
    resolver?.({ decision: "deny" });
    set({ open: false, request: null, resolver: null });
  },
}));
