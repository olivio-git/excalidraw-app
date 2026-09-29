/**
 * Browser stand-in for the Tauri backend, injected before the app loads.
 * Files live in memory (window.__files); commands a test cares about are
 * recorded (window.__calls, window.__writes, window.__commands).
 *
 * Tests preload files with `window.__files = {...}` in an init script and
 * answer dialogs with window.__nextOpen / window.__nextSave.
 */
(() => {
  const files = (window.__files ||= {});
  const encoder = new TextEncoder();
  const callbacks = new Map();
  const listeners = {};
  let next = 1;
  const normalize = (path) => String(path).replace(/\/+/g, "/");

  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  window.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { windowLabel: "main", label: "main" },
    },
    transformCallback: (callback) => {
      const id = next++;
      callbacks.set(id, callback);
      return id;
    },
    unregisterCallback: (id) => callbacks.delete(id),
    convertFileSrc: (path) => "asset://localhost/" + encodeURIComponent(path),
    invoke: async (cmd, args = {}, options = {}) => {
      (window.__calls ||= []).push(cmd);
      switch (cmd) {
        case "plugin:event|listen":
          (listeners[args.event] ||= []).push(args.handler);
          return args.handler;
        case "plugin:path|normalize":
          return normalize(args.path);
        case "plugin:path|join":
          return normalize(args.paths.join("/"));
        case "plugin:path|dirname":
          return String(args.path).replace(/\/[^/]*$/, "") || "/";
        case "plugin:path|basename":
          return String(args.path).split("/").pop();
        case "plugin:path|extname":
          return String(args.path).split(".").pop() || "";
        case "plugin:path|is_absolute":
          return String(args.path).startsWith("/");
        case "plugin:path|resolve_directory":
          return "/appdata";
        case "plugin:fs|read_dir": {
          const dir = String(args.path).replace(/\/$/, "");
          const names = new Set();
          for (const path of Object.keys(files))
            if (path.startsWith(dir + "/")) names.add(path.slice(dir.length + 1).split("/")[0]);
          return [...names].map((name) => ({
            name,
            isDirectory: !(dir + "/" + name in files),
            isFile: dir + "/" + name in files,
            isSymlink: false,
          }));
        }
        case "plugin:fs|stat":
        case "plugin:fs|lstat":
          return {
            isFile: args.path in files,
            isDirectory: !(args.path in files),
            isSymlink: false,
            size: (files[args.path] || "").length,
            mtime: 1,
            atime: 1,
            birthtime: 1,
            readonly: false,
          };
        case "plugin:fs|exists":
          return (
            args.path in files || Object.keys(files).some((p) => p.startsWith(args.path + "/"))
          );
        case "plugin:fs|read_text_file":
        case "plugin:fs|read_file":
          if (!(args.path in files)) throw new Error("ENOENT " + args.path);
          return Array.from(encoder.encode(files[args.path]));
        case "plugin:fs|write_text_file":
        case "plugin:fs|write_file": {
          const path = decodeURIComponent(options.headers.path);
          const bytes = args instanceof Uint8Array ? args : new Uint8Array(args);
          files[path] = new TextDecoder().decode(bytes);
          (window.__writes ||= []).push(path);
          return null;
        }
        case "plugin:fs|mkdir":
        case "plugin:fs|watch":
          return 1;
        case "plugin:dialog|open":
          return window.__nextOpen ?? null;
        case "plugin:dialog|save":
          return window.__nextSave ?? null;
        case "plugin:store|load":
          return next++;
        case "plugin:store|get":
          return [null, false];
        case "chat_list_conversations":
        case "get_external_plugins":
          return [];
        case "pty_list_shells":
          return [];
        case "exthost_start":
          throw new Error("no extension host in tests");
        case "flow_run_command": {
          (window.__commands ||= []).push(args);
          const command = String(args.command);
          if (command.startsWith("echo ")) {
            return { stdout: command.slice(5) + "\n", stderr: "", code: 0, timedOut: false };
          }
          return { stdout: "", stderr: "command not found", code: 127, timedOut: false };
        }
        default:
          return null;
      }
    },
  };
})();
