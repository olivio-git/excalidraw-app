/**
 * Shared DocumentController singleton for use within the document-editor feature.
 *
 * plugin-api.ts also creates a DocumentController singleton but it's private to
 * that module. This singleton is used by hooks and components within this feature
 * that need direct access without going through the PluginAPI (which requires
 * being inside a plugin activate() context).
 *
 * Both singletons share the same underlying store and file service, so they are
 * functionally equivalent.
 */
import { useDocumentStore } from "@/stores/documentStore";
import { DocumentController } from "./DocumentController";
import { documentFileService } from "./documentFileService";

let _instance: DocumentController | null = null;

export function getDocumentController(): DocumentController {
  if (!_instance) {
    _instance = new DocumentController(useDocumentStore, documentFileService);
  }
  return _instance;
}
