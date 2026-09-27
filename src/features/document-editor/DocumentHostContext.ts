import { createContext } from "react";
import type { EditorGroupId } from "@/core/tabs/types";

export interface DocumentHost {
  filePath: string;
  groupId: EditorGroupId;
}
export const DocumentHostContext = createContext<DocumentHost | null>(null);
