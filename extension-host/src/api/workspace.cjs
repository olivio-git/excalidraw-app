"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const {
  EventEmitter,
  noneEvent,
  Uri,
  FileType,
  FileSystemError,
  RelativePattern,
  Disposable,
} = require("./types.cjs");
const { TextDocumentData, applyTextEdits, languageIdFromPath } = require("./documents.cjs");
const { globToRegExp, toPosix } = require("./glob.cjs");

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "out",
  "target",
  ".next",
]);
const MAX_SCAN = 20000;

/**
 * `vscode.workspace`: folders, configuration, file system, documents,
 * file watchers and edits.
 */
function createWorkspace(host) {
  let folders = [];
  const onDidChangeWorkspaceFolders = new EventEmitter();
  const onDidOpenTextDocument = new EventEmitter();
  const onDidCloseTextDocument = new EventEmitter();
  const onDidChangeTextDocument = new EventEmitter();
  const onDidSaveTextDocument = new EventEmitter();
  const onWillSaveTextDocument = new EventEmitter();
  const onDidCreateFiles = new EventEmitter();
  const onDidDeleteFiles = new EventEmitter();
  const onDidRenameFiles = new EventEmitter();
  /** uri string → TextDocumentData, for documents open in the app or opened by extensions. */
  const documents = new Map();
  const contentProviders = new Map();

  function setFolders(paths) {
    const previous = folders;
    folders = (paths ?? []).map((p, index) => ({
      uri: Uri.file(p),
      name: path.basename(p) || p,
      index,
    }));
    const added = folders.filter((f) => !previous.some((p) => p.uri.fsPath === f.uri.fsPath));
    const removed = previous.filter((p) => !folders.some((f) => f.uri.fsPath === p.uri.fsPath));
    if (added.length || removed.length) onDidChangeWorkspaceFolders.fire({ added, removed });
  }

  function getWorkspaceFolder(uri) {
    const target = toPosix(uri.fsPath);
    return folders
      .filter(
        (f) => target === toPosix(f.uri.fsPath) || target.startsWith(`${toPosix(f.uri.fsPath)}/`)
      )
      .sort((a, b) => b.uri.fsPath.length - a.uri.fsPath.length)[0];
  }

  function asRelativePath(pathOrUri, includeWorkspaceFolder) {
    const fsPath = typeof pathOrUri === "string" ? pathOrUri : pathOrUri.fsPath;
    const folder = getWorkspaceFolder(Uri.file(fsPath));
    if (!folder) return fsPath;
    const relative = toPosix(path.relative(folder.uri.fsPath, fsPath));
    return (includeWorkspaceFolder ?? folders.length > 1) ? `${folder.name}/${relative}` : relative;
  }

  // ── File system ─────────────────────────────────────────────────────────
  function mapError(error, uri) {
    switch (error && error.code) {
      case "ENOENT":
        return FileSystemError.FileNotFound(uri);
      case "EEXIST":
        return FileSystemError.FileExists(uri);
      case "ENOTDIR":
        return FileSystemError.FileNotADirectory(uri);
      case "EISDIR":
        return FileSystemError.FileIsADirectory(uri);
      case "EACCES":
      case "EPERM":
        return FileSystemError.NoPermissions(uri);
      default:
        return error;
    }
  }

  function fileType(stat) {
    let type = FileType.Unknown;
    if (stat.isFile()) type = FileType.File;
    else if (stat.isDirectory()) type = FileType.Directory;
    if (stat.isSymbolicLink && stat.isSymbolicLink()) type |= FileType.SymbolicLink;
    return type;
  }

  const guard =
    (fn) =>
    async (uri, ...args) => {
      try {
        return await fn(uri, ...args);
      } catch (error) {
        throw mapError(error, uri);
      }
    };

  const fileSystem = {
    stat: guard(async (uri) => {
      const stat = await fsp.stat(uri.fsPath);
      const lstat = await fsp.lstat(uri.fsPath);
      return {
        type: fileType(stat) | (lstat.isSymbolicLink() ? FileType.SymbolicLink : 0),
        ctime: stat.ctimeMs,
        mtime: stat.mtimeMs,
        size: stat.size,
      };
    }),
    readDirectory: guard(async (uri) => {
      const entries = await fsp.readdir(uri.fsPath, { withFileTypes: true });
      return entries.map((entry) => [
        entry.name,
        entry.isDirectory()
          ? FileType.Directory
          : entry.isFile()
            ? FileType.File
            : FileType.Unknown,
      ]);
    }),
    createDirectory: guard((uri) =>
      fsp.mkdir(uri.fsPath, { recursive: true }).then(() => undefined)
    ),
    readFile: guard(async (uri) => new Uint8Array(await fsp.readFile(uri.fsPath))),
    writeFile: guard(async (uri, content) => {
      await fsp.mkdir(path.dirname(uri.fsPath), { recursive: true });
      await fsp.writeFile(uri.fsPath, content);
    }),
    delete: guard((uri, options = {}) =>
      fsp.rm(uri.fsPath, { recursive: !!options.recursive, force: false })
    ),
    rename: guard(async (source, target, options = {}) => {
      if (!options.overwrite && fs.existsSync(target.fsPath))
        throw Object.assign(new Error("exists"), { code: "EEXIST" });
      await fsp.rename(source.fsPath, target.fsPath);
    }),
    copy: guard(async (source, target, options = {}) => {
      await fsp.cp(source.fsPath, target.fsPath, {
        recursive: true,
        force: !!options.overwrite,
        errorOnExist: !options.overwrite,
      });
    }),
    isWritableFileSystem: (scheme) => (scheme === "file" ? true : undefined),
  };

  // ── Finding files ───────────────────────────────────────────────────────
  function patternParts(include) {
    if (
      include instanceof RelativePattern ||
      (include && include.pattern !== undefined && include.baseUri)
    ) {
      return { roots: [include.baseUri.fsPath], regex: globToRegExp(toPosix(include.pattern)) };
    }
    return {
      roots: folders.map((f) => f.uri.fsPath),
      regex: globToRegExp(toPosix(String(include))),
    };
  }

  async function findFiles(include, exclude, maxResults, token) {
    const { roots, regex } = patternParts(include);
    const excludeRegex = exclude ? patternParts(exclude).regex : null;
    const results = [];
    let scanned = 0;
    const limit = maxResults ?? Infinity;
    const walk = async (root, dir) => {
      if (results.length >= limit || scanned > MAX_SCAN || token?.isCancellationRequested) return;
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (results.length >= limit) return;
        scanned++;
        const full = path.join(dir, entry.name);
        const relative = toPosix(path.relative(root, full));
        if (entry.isDirectory()) {
          if (IGNORED_DIRS.has(entry.name) && !regex.source.includes(entry.name)) continue;
          await walk(root, full);
        } else if (regex.test(relative) && !(excludeRegex && excludeRegex.test(relative))) {
          results.push(Uri.file(full));
        }
      }
    };
    for (const root of roots) await walk(root, root);
    return results;
  }

  // ── Watchers ────────────────────────────────────────────────────────────
  function createFileSystemWatcher(globPattern, ignoreCreate, ignoreChange, ignoreDelete) {
    const onDidCreate = new EventEmitter();
    const onDidChange = new EventEmitter();
    const onDidDelete = new EventEmitter();
    const { roots, regex } = patternParts(globPattern);
    const watchers = [];
    const pendingTimers = new Map();
    for (const root of roots) {
      try {
        const watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
          if (!filename) return;
          const relative = toPosix(String(filename));
          if (!regex.test(relative)) return;
          const full = path.join(root, String(filename));
          clearTimeout(pendingTimers.get(full));
          pendingTimers.set(
            full,
            setTimeout(() => {
              pendingTimers.delete(full);
              const uri = Uri.file(full);
              const exists = fs.existsSync(full);
              if (!exists) {
                if (!ignoreDelete) onDidDelete.fire(uri);
              } else if (!ignoreChange) {
                onDidChange.fire(uri);
              }
            }, 100)
          );
        });
        watcher.on("error", () => undefined);
        watchers.push(watcher);
      } catch {
        // Recursive watching is not available everywhere; events just won't fire.
      }
    }
    return {
      ignoreCreateEvents: !!ignoreCreate,
      ignoreChangeEvents: !!ignoreChange,
      ignoreDeleteEvents: !!ignoreDelete,
      onDidCreate: onDidCreate.event,
      onDidChange: onDidChange.event,
      onDidDelete: onDidDelete.event,
      dispose() {
        watchers.forEach((w) => w.close());
        pendingTimers.forEach((t) => clearTimeout(t));
      },
    };
  }

  // ── Documents ───────────────────────────────────────────────────────────
  function languages() {
    return host.extensionDescriptions().flatMap((ext) => ext.contributes?.languages ?? []);
  }

  function saveDocument(data) {
    return host.rpc
      .request("document.save", { path: data.uri.fsPath })
      .then((ok) => ok !== false)
      .catch(() => false);
  }

  /** Register (or update) a document the app has open. */
  function acceptDocument({ path: fsPath, languageId, version, text }) {
    const uri = Uri.file(fsPath);
    const key = uri.toString();
    const existing = documents.get(key);
    if (existing && !existing.isClosed) {
      existing.languageId = languageId ?? existing.languageId;
      if (text !== existing.text) {
        existing.setText(text);
        existing.version = version ?? existing.version + 1;
      }
      return existing;
    }
    const data = new TextDocumentData(
      uri,
      languageId ?? languageIdFromPath(fsPath, languages()),
      version ?? 1,
      text,
      saveDocument
    );
    documents.set(key, data);
    onDidOpenTextDocument.fire(data.document);
    return data;
  }

  async function openTextDocument(arg) {
    if (
      arg === undefined ||
      (typeof arg === "object" && !(arg instanceof Uri) && !arg.scheme && !arg.fsPath)
    ) {
      const options = arg ?? {};
      const uri = Uri.from({ scheme: "untitled", path: `Untitled-${documents.size + 1}` });
      const data = new TextDocumentData(
        uri,
        options.language ?? "plaintext",
        1,
        options.content ?? ""
      );
      documents.set(uri.toString(), data);
      onDidOpenTextDocument.fire(data.document);
      return data.document;
    }
    const uri = typeof arg === "string" ? Uri.file(arg) : arg instanceof Uri ? arg : Uri.from(arg);
    const existing = documents.get(uri.toString());
    if (existing && !existing.isClosed) return existing.document;
    if (uri.scheme !== "file") {
      const provider = contentProviders.get(uri.scheme);
      if (!provider)
        throw new Error(
          `cannot open ${uri.toString()}. Detail: No content provider for '${uri.scheme}'`
        );
      const text =
        (await provider.provideTextDocumentContent(uri, { isCancellationRequested: false })) ?? "";
      const data = new TextDocumentData(uri, "plaintext", 1, text);
      documents.set(uri.toString(), data);
      onDidOpenTextDocument.fire(data.document);
      return data.document;
    }
    let text;
    try {
      text = await fsp.readFile(uri.fsPath, "utf8");
    } catch (error) {
      throw mapError(error, uri);
    }
    return acceptDocument({ path: uri.fsPath, text }).document;
  }

  /** Apply a WorkspaceEdit: open documents are edited in the app, the rest on disk. */
  async function applyEdit(edit) {
    try {
      for (const entry of edit._edits ?? []) {
        if (entry.kind === "create") {
          if (!entry.options?.ignoreIfExists || !fs.existsSync(entry.uri.fsPath)) {
            await fileSystem.writeFile(entry.uri, new Uint8Array());
          }
          onDidCreateFiles.fire({ files: [entry.uri] });
        } else if (entry.kind === "delete") {
          await fsp.rm(entry.uri.fsPath, {
            recursive: !!entry.options?.recursive,
            force: !!entry.options?.ignoreIfNotExists,
          });
          onDidDeleteFiles.fire({ files: [entry.uri] });
        } else if (entry.kind === "rename") {
          await fileSystem.rename(entry.uri, entry.newUri, entry.options);
          onDidRenameFiles.fire({ files: [{ oldUri: entry.uri, newUri: entry.newUri }] });
        }
      }
      for (const [uri, edits] of edit.entries()) {
        const key = uri.toString();
        const open = documents.get(key);
        const payload = edits.map((e) => ({
          range: {
            start: { line: e.range.start.line, character: e.range.start.character },
            end: { line: e.range.end.line, character: e.range.end.character },
          },
          newText: e.newText,
        }));
        if (open && !open.isClosed && uri.scheme === "file") {
          const applied = await host.rpc.request("document.applyEdits", {
            path: uri.fsPath,
            edits: payload,
          });
          if (applied === false) return false;
        } else if (uri.scheme === "file") {
          const text = await fsp.readFile(uri.fsPath, "utf8");
          await fsp.writeFile(uri.fsPath, applyTextEdits(text, edits));
        }
      }
      return true;
    } catch (error) {
      host.log("error", `applyEdit failed: ${error && error.message}`);
      return false;
    }
  }

  const api = {
    get workspaceFolders() {
      return folders.length ? folders : undefined;
    },
    get name() {
      return folders.length ? folders.map((f) => f.name).join(", ") : undefined;
    },
    get rootPath() {
      return folders[0]?.uri.fsPath;
    },
    workspaceFile: undefined,
    isTrusted: true,
    onDidGrantWorkspaceTrust: noneEvent,
    getWorkspaceFolder,
    asRelativePath,
    updateWorkspaceFolders: () => false,
    onDidChangeWorkspaceFolders: onDidChangeWorkspaceFolders.event,
    getConfiguration: (section, _scope) => host.configuration.getConfiguration(section),
    onDidChangeConfiguration: host.configuration.onDidChangeConfiguration,
    fs: fileSystem,
    findFiles,
    createFileSystemWatcher,
    get textDocuments() {
      return [...documents.values()].filter((d) => !d.isClosed).map((d) => d.document);
    },
    openTextDocument,
    onDidOpenTextDocument: onDidOpenTextDocument.event,
    onDidCloseTextDocument: onDidCloseTextDocument.event,
    onDidChangeTextDocument: onDidChangeTextDocument.event,
    onDidSaveTextDocument: onDidSaveTextDocument.event,
    onWillSaveTextDocument: onWillSaveTextDocument.event,
    onDidCreateFiles: onDidCreateFiles.event,
    onDidDeleteFiles: onDidDeleteFiles.event,
    onDidRenameFiles: onDidRenameFiles.event,
    onWillCreateFiles: noneEvent,
    onWillDeleteFiles: noneEvent,
    onWillRenameFiles: noneEvent,
    applyEdit,
    saveAll: () =>
      host.rpc
        .request("document.saveAll", {})
        .then((ok) => ok !== false)
        .catch(() => false),
    save: (uri) =>
      host.rpc.request("document.save", { path: uri.fsPath }).then((ok) => (ok ? uri : undefined)),
    registerTextDocumentContentProvider(scheme, provider) {
      contentProviders.set(scheme, provider);
      return new Disposable(() => {
        if (contentProviders.get(scheme) === provider) contentProviders.delete(scheme);
      });
    },
    registerFileSystemProvider: () => new Disposable(() => {}),
    registerTaskProvider: () => new Disposable(() => {}),
    notebookDocuments: [],
    onDidOpenNotebookDocument: noneEvent,
    onDidCloseNotebookDocument: noneEvent,
    onDidChangeNotebookDocument: noneEvent,
    onDidSaveNotebookDocument: noneEvent,
  };

  return {
    api,
    setFolders,
    asRelativePath,
    documents,
    acceptDocument,
    events: {
      onDidOpenTextDocument,
      onDidCloseTextDocument,
      onDidChangeTextDocument,
      onDidSaveTextDocument,
    },
  };
}

module.exports = { createWorkspace };
