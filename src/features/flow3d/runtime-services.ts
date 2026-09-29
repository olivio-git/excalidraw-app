import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { PluginManager } from "@/plugins/plugin-manager";
import { useAISettingsStore } from "@/features/settings/ai/ai-settings-store";
import { AIProviderFactory } from "@/features/ai-chat/providers/factory";
import { looseJson, type CommandResult, type ExecutorServices } from "./executor";

const AI_SYSTEM =
  "Eres un paso dentro de un flujo automatizado. Responde solo con el resultado pedido, sin explicaciones ni saludos.";

const dirname = (path: string) => path.replace(/[\\/][^\\/]*$/, "") || path;
const isAbsolute = (path: string) => /^([a-zA-Z]:[\\/]|[\\/])/.test(path);

/** Resolve a path written in a step: absolute, or relative to the flow file. */
export function resolveStepPath(path: string, flowPath: string): string {
  const clean = path.trim().replace(/^\/@workspace\//, "");
  if (isAbsolute(clean)) return clean;
  const base = dirname(flowPath);
  const separator = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  return `${base}${separator}${clean.replace(/^\.[\\/]/, "")}`;
}

/** Services that run steps on the real platform (Tauri). */
export function createRuntimeServices(flowPath: string): ExecutorServices {
  return {
    http: async ({ method, url, headers, body, signal }) => {
      const response = await tauriFetch(url, { method, headers, body, signal });
      const text = await response.text();
      const type = response.headers.get("content-type") ?? "";
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      return {
        status: response.status,
        headers: responseHeaders,
        body: type.includes("json") || /^\s*[[{]/.test(text) ? looseJson(text) : text,
      };
    },

    shell: ({ command, cwd, timeoutMs }) =>
      invoke<CommandResult>("flow_run_command", {
        command,
        cwd: cwd ? resolveStepPath(cwd, flowPath) : dirname(flowPath),
        timeoutMs,
      }),

    appCommand: async (id) => {
      if (!PluginManager.hasCommand(id)) throw new Error(`Comando no encontrado: ${id}`);
      await PluginManager.executeCommand(id);
    },

    ai: async ({ prompt, system, signal }) => {
      const { provider, config } = useAISettingsStore.getState().getActiveConfig();
      if (provider !== "openai-codex" && !config.apiKey) {
        throw new Error("No hay clave de IA configurada (Ajustes → IA)");
      }
      const adapter = await AIProviderFactory.create(provider);
      let answer = "";
      for await (const chunk of adapter.stream(
        [{ id: "flow3d", role: "user", content: prompt, timestamp: Date.now() }],
        system ?? AI_SYSTEM,
        [],
        config,
        signal
      )) {
        if (chunk.type === "text_delta") answer += chunk.delta;
        else if (chunk.type === "error") throw new Error(chunk.message);
      }
      return answer.trim();
    },

    writeFile: async ({ path, content, append }) => {
      const target = resolveStepPath(path, flowPath);
      let text = content;
      if (append) {
        const previous = await readTextFile(target).catch(() => "");
        text = previous ? `${previous.replace(/\n*$/, "")}\n\n${content}` : content;
      }
      await writeTextFile(target, text.endsWith("\n") ? text : `${text}\n`);
      return target;
    },
  };
}
